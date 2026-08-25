import type {
  RepositoryRisk,
  RepositoryScanResult,
  WebhookSurface
} from "./repositoryScanner.js";

export interface SuggestedInvariant {
  id: string;
  name: string;
  expression: string;
  rationale: string;
}

export interface SuggestedHypothesis {
  id: string;
  title: string;
  scenario:
    | "forged-webhook"
    | "duplicate-after-timeout"
    | "concurrent-delivery-race"
    | "out-of-order-regression"
    | "crash-before-side-effect";
  evidence: string[];
  confidence: number;
  financialImpact: string;
}

export interface IntelligenceResult {
  provider: "local" | "openai";
  model: string;
  summary: string;
  invariants: SuggestedInvariant[];
  hypotheses: SuggestedHypothesis[];
  responseId?: string;
  fallbackReason?: string;
}

export interface IntelligenceStatus {
  configured: boolean;
  provider: "local" | "openai";
  model: string;
  privacy: string;
}

interface IntelligencePayload {
  summary: string;
  invariants: SuggestedInvariant[];
  hypotheses: SuggestedHypothesis[];
}

const intelligenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    invariants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          expression: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["id", "name", "expression", "rationale"]
      }
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          scenario: {
            type: "string",
            enum: [
              "forged-webhook",
              "duplicate-after-timeout",
              "concurrent-delivery-race",
              "out-of-order-regression",
              "crash-before-side-effect"
            ]
          },
          evidence: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          financialImpact: { type: "string" }
        },
        required: [
          "id",
          "title",
          "scenario",
          "evidence",
          "confidence",
          "financialImpact"
        ]
      }
    }
  },
  required: ["summary", "invariants", "hypotheses"]
} as const;

function invariantForRisk(risk: RepositoryRisk): SuggestedInvariant {
  if (risk.id === "missing-signature-verification") {
    return {
      id: "INV-AUTH-001",
      name: "Authentic webhook mutation",
      expression: "mutates_financial_state(E) ⇒ valid_razorpay_signature(E)",
      rationale: "Unverified requests must never trigger a financial or fulfilment side effect."
    };
  }
  if (risk.id === "non-monotonic-payment-state") {
    return {
      id: "INV-002",
      name: "Captured state is monotonic",
      expression: "captured(P) ⇒ final_status(P) = CAPTURED",
      rationale: "An older failure snapshot must not overwrite confirmed captured funds."
    };
  }
  if (risk.id === "non-atomic-external-side-effect") {
    return {
      id: "INV-003",
      name: "Durable fulfilment dispatch",
      expression: "captured(P) ⇒ count(shipment_jobs(order(P))) = 1",
      rationale: "A process crash must not separate committed payment state from its required external side effect."
    };
  }
  if (risk.id === "non-atomic-idempotency-check") {
    return {
      id: "INV-004",
      name: "Atomic concurrent fulfilment",
      expression: "concurrent(deliveries(E)) ⇒ count(fulfilments(payment(E))) <= 1",
      rationale: "Two workers must not both pass an idempotency check before either records the event."
    };
  }
  return {
    id: "INV-001",
    name: "Exactly-once fulfilment",
    expression: "count(fulfilments where payment_id = P) <= 1",
    rationale: "At-least-once webhook delivery must not repeat an irreversible business side effect."
  };
}

function hypothesisForRisk(risk: RepositoryRisk, index: number): SuggestedHypothesis {
  return {
    id: `HYP-SCAN-${String(index + 1).padStart(3, "0")}`,
    title: risk.title,
    scenario: risk.suggestedScenario,
    evidence: [`${risk.file}:${risk.line}`, risk.reason],
    confidence: risk.severity === "critical" ? 0.97 : 0.91,
    financialImpact:
      risk.id === "missing-event-idempotency"
        ? "Duplicate order, shipment, credit, or entitlement for one captured payment."
        : risk.id === "non-atomic-idempotency-check"
          ? "Simultaneous deliveries can duplicate fulfilment despite an apparent idempotency check."
        : risk.id === "non-monotonic-payment-state"
          ? "Paid orders can be treated as unpaid, withheld, or incorrectly recovered."
          : risk.id === "non-atomic-external-side-effect"
            ? "Captured orders can remain permanently stranded without shipment work."
          : "A forged request can create unauthorized financial state or fulfilment."
  };
}

export function analyzeLocally(scan: RepositoryScanResult): IntelligenceResult {
  const invariants = scan.risks
    .map(invariantForRisk)
    .filter((invariant, index, values) =>
      values.findIndex((candidate) => candidate.id === invariant.id) === index
    );

  return {
    provider: "local",
    model: "grounded-rules-v1",
    summary:
      scan.risks.length === 0
        ? `${scan.webhookSurfaces.length} payment surface${scan.webhookSurfaces.length === 1 ? " was" : "s were"} mapped with no supported static risk pattern. Deterministic campaigns are still required.`
        : `${scan.risks.length} architecture-grounded failure hypothesis candidate${scan.risks.length === 1 ? " was" : "s were"} found across ${scan.webhookSurfaces.length} payment surface${scan.webhookSurfaces.length === 1 ? "" : "s"}.`,
    invariants,
    hypotheses: scan.risks.map(hypothesisForRisk)
  };
}

function modelInput(scan: RepositoryScanResult) {
  return {
    filesScanned: scan.filesScanned,
    languages: scan.languages,
    providers: scan.providers,
    webhookSurfaces: scan.webhookSurfaces.map((surface: WebhookSurface) => ({
      ...surface,
      file: surface.file.slice(0, 240)
    })),
    staticRisks: scan.risks,
    note: "Static risks are unproven candidates. Only deterministic campaign results may declare pass or fail."
  };
}

function isPayload(value: unknown): value is IntelligencePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IntelligencePayload>;
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.invariants) &&
    candidate.invariants.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.expression === "string" &&
        typeof item.rationale === "string"
    ) &&
    Array.isArray(candidate.hypotheses) &&
    candidate.hypotheses.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        [
          "forged-webhook",
          "duplicate-after-timeout",
          "concurrent-delivery-race",
          "out-of-order-regression",
          "crash-before-side-effect"
        ].includes(item.scenario) &&
        Array.isArray(item.evidence) &&
        item.evidence.every((evidence) => typeof evidence === "string") &&
        typeof item.confidence === "number" &&
        typeof item.financialImpact === "string"
    )
  );
}

interface OpenAIResponse {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string } | null;
}

function extractOutputText(response: OpenAIResponse): string {
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error(response.error?.message ?? "The model returned no structured output.");
}

export class OpenAIIntelligenceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-5.4",
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async analyze(scan: RepositoryScanResult): Promise<IntelligenceResult> {
    const response = await this.fetchImplementation("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions:
          "You are PayChaos's defensive payment reliability analyst. Use only the supplied repository scan evidence. Suggest financial invariants and ranked failure hypotheses. Never declare pass, fail, exploit success, or a proven vulnerability; deterministic campaigns make those decisions. Do not invent files, routes, controls, or payment events.",
        input: JSON.stringify(modelInput(scan)),
        max_output_tokens: 1_600,
        text: {
          format: {
            type: "json_schema",
            name: "paychaos_repository_intelligence",
            strict: true,
            schema: intelligenceSchema
          }
        }
      }),
      signal: AbortSignal.timeout(25_000)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI Responses API returned ${response.status}: ${message.slice(0, 300)}`);
    }

    const raw = (await response.json()) as OpenAIResponse;
    const parsed = JSON.parse(extractOutputText(raw)) as unknown;
    if (!isPayload(parsed)) throw new Error("The structured intelligence payload was invalid.");

    return {
      provider: "openai",
      model: this.model,
      responseId: raw.id,
      ...parsed
    };
  }
}

export class IntelligenceService {
  private readonly apiKey = process.env.OPENAI_API_KEY?.trim();
  private readonly model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";

  status(): IntelligenceStatus {
    return this.apiKey
      ? {
          configured: true,
          provider: "openai",
          model: this.model,
          privacy: "Only bounded scan metadata is sent after explicit AI enrichment. Source content stays local."
        }
      : {
          configured: false,
          provider: "local",
          model: "grounded-rules-v1",
          privacy: "No source or scan metadata leaves this process."
        };
  }

  async analyze(scan: RepositoryScanResult, useAI = false): Promise<IntelligenceResult> {
    if (!useAI || !this.apiKey) return analyzeLocally(scan);

    try {
      return await new OpenAIIntelligenceProvider(this.apiKey, this.model).analyze(scan);
    } catch (error) {
      return {
        ...analyzeLocally(scan),
        fallbackReason: error instanceof Error ? error.message : "OpenAI analysis failed."
      };
    }
  }
}
