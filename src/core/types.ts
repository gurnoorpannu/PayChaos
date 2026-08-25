export type ProtectionMode = "vulnerable" | "protected";
export type ScenarioId =
  | "duplicate-after-timeout"
  | "out-of-order-regression"
  | "crash-before-side-effect"
  | "concurrent-delivery-race";

export type TimelineKind =
  | "analysis"
  | "webhook"
  | "database"
  | "network"
  | "invariant";

export interface PaymentWebhook {
  eventId: string;
  event: "payment.captured" | "payment.failed";
  paymentId: string;
  orderId: string;
  amount: number;
  currency: "INR";
  createdAt?: number;
}

export interface SignedWebhookRequest {
  webhook: PaymentWebhook;
  rawBody: string;
  headers: {
    "x-razorpay-event-id": string;
    "x-razorpay-signature": string;
  };
}

export interface Fulfilment {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  offsetMs: number;
  kind: TimelineKind;
  tone: "neutral" | "success" | "warning" | "danger";
  title: string;
  detail: string;
  data?: Record<string, string | number | boolean>;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  detail: string;
  kind: "entry" | "logic" | "database" | "external";
  risk?: boolean;
}

export interface ArchitectureAnalysis {
  framework: string;
  filesScanned: number;
  webhookRoute: string;
  detectedEvent: string;
  sideEffect: string;
  idempotencyGuard: boolean;
  confidence: number;
  evidence: {
    file: string;
    line: number;
    excerpt: string;
  };
  nodes: ArchitectureNode[];
}

export interface Hypothesis {
  id: string;
  title: string;
  reasoning: string;
  faultPlan: string[];
  invariant: string;
  confidence: number;
}

export interface InvariantResult {
  id: string;
  name: string;
  expression: string;
  expected: string;
  observed: string;
  passed: boolean;
}

export interface CampaignReport {
  id: string;
  mode: ProtectionMode;
  scenario: ScenarioId;
  execution: {
    kind: "deterministic-model" | "live-http";
    target: string;
    transport: "in-process" | "HTTP";
    requests: number;
    stateReads: number;
  };
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  architecture: ArchitectureAnalysis;
  hypothesis: Hypothesis;
  timeline: TimelineEntry[];
  invariants: InvariantResult[];
  fulfilments: Fulfilment[];
  evidenceTable: {
    title: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, string | number | boolean>>;
  };
  finding: {
    severity: "critical" | "none";
    title: string;
    whatBroke: string;
    whyItBroke: string;
    whereItBroke: string;
    financialImpact: string;
    reproduction: string[];
    suggestedFix: string;
  };
  resilienceScore: number;
}

export interface OverviewResponse {
  target: {
    name: string;
    environment: string;
    stack: string;
  };
  scenarios: Array<{
    id: string;
    scenario: ScenarioId;
    name: string;
    description: string;
    operators: string[];
  }>;
  source: string;
}
