import { describe, expect, it, vi } from "vitest";
import {
  analyzeLocally,
  OpenAIIntelligenceProvider
} from "./intelligence.js";
import type { RepositoryScanResult } from "./repositoryScanner.js";

const scan: RepositoryScanResult = {
  root: "/secret/local/project",
  filesScanned: 12,
  bytesRead: 4_096,
  truncated: false,
  languages: { ts: 12 },
  providers: ["Razorpay"],
  webhookSurfaces: [
    {
      file: "src/webhook.ts",
      line: 8,
      route: "/webhooks/razorpay",
      events: ["payment.captured"],
      signatureVerification: true,
      eventIdIdempotency: false,
      transactionBoundary: false,
      monotonicStateGuard: false,
      sideEffects: ["create fulfilment"]
    }
  ],
  risks: [
    {
      id: "missing-event-idempotency",
      severity: "critical",
      title: "Captured payment can repeat an irreversible side effect",
      file: "src/webhook.ts",
      line: 8,
      reason: "No unique event claim was detected.",
      suggestedScenario: "duplicate-after-timeout"
    }
  ],
  staticScore: 72
};

describe("repository intelligence", () => {
  it("turns scan evidence into local hypothesis candidates", () => {
    const result = analyzeLocally(scan);

    expect(result.provider).toBe("local");
    expect(result.invariants[0].id).toBe("INV-001");
    expect(result.hypotheses[0]).toMatchObject({
      scenario: "duplicate-after-timeout",
      confidence: 0.97
    });
    expect(result.hypotheses[0].evidence[0]).toBe("src/webhook.ts:8");
  });

  it("requests strict, non-persistent structured output", async () => {
    const modelPayload = {
      summary: "One grounded hypothesis.",
      invariants: [
        {
          id: "INV-001",
          name: "Exactly-once fulfilment",
          expression: "count(fulfilments(P)) <= 1",
          rationale: "Retries must not repeat fulfilment."
        }
      ],
      hypotheses: [
        {
          id: "HYP-AI-001",
          title: "Post-commit timeout repeats fulfilment",
          scenario: "duplicate-after-timeout",
          evidence: ["src/webhook.ts:8"],
          confidence: 0.96,
          financialImpact: "Duplicate fulfilment exposure."
        }
      ]
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ id: "resp_test", output_text: JSON.stringify(modelPayload) }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new OpenAIIntelligenceProvider(
      "test-key",
      "gpt-5.4",
      fetchMock as unknown as typeof fetch
    );

    const result = await provider.analyze(scan);
    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String((request[1] as RequestInit).body));

    expect(request[0]).toBe("https://api.openai.com/v1/responses");
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true
    });
    expect(body.input).not.toContain("/secret/local/project");
    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      responseId: "resp_test"
    });
  });

  it("rejects output that does not satisfy the intelligence contract", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ output_text: "{}" }), { status: 200 })
    );
    const provider = new OpenAIIntelligenceProvider(
      "test-key",
      "gpt-5.4",
      fetchMock as unknown as typeof fetch
    );

    await expect(provider.analyze(scan)).rejects.toThrow(
      "structured intelligence payload was invalid"
    );
  });
});
