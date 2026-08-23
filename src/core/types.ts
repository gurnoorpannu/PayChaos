export type ProtectionMode = "vulnerable" | "protected";

export type TimelineKind =
  | "analysis"
  | "webhook"
  | "database"
  | "network"
  | "invariant";

export interface PaymentWebhook {
  eventId: string;
  event: "payment.captured";
  paymentId: string;
  orderId: string;
  amount: number;
  currency: "INR";
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
  scenario: "duplicate-after-timeout";
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  architecture: ArchitectureAnalysis;
  hypothesis: Hypothesis;
  timeline: TimelineEntry[];
  invariants: InvariantResult[];
  fulfilments: Fulfilment[];
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
  scenario: {
    id: string;
    name: string;
    description: string;
    operators: string[];
  };
  source: string;
}
