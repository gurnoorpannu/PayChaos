import { randomUUID } from "node:crypto";
import { analyzeMerchant, generateHypothesis } from "./analyzer.js";
import { createSignedWebhookRequest, demoWebhookSecret, verifyRazorpayWebhook } from "./razorpay.js";
import type {
  CampaignReport,
  PaymentWebhook,
  ProtectionMode,
  TimelineEntry
} from "./types.js";

type PaymentState = "CREATED" | "CAPTURED" | "FAILED";

interface StateTransition {
  id: string;
  event: PaymentWebhook["event"];
  previous: PaymentState;
  next: PaymentState;
  outcome: "applied" | "ignored";
}

const capturedWebhook: PaymentWebhook = {
  eventId: "evt_Q8m4Captured",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_925_860
};

const failedWebhook: PaymentWebhook = {
  eventId: "evt_Q8m4Failed",
  event: "payment.failed",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_925_800
};

function verifyRequest(event: PaymentWebhook) {
  const request = createSignedWebhookRequest(event);
  return verifyRazorpayWebhook(
    request.rawBody,
    request.headers["x-razorpay-signature"],
    demoWebhookSecret
  );
}

export function runOutOfOrderCampaign(
  mode: ProtectionMode = "vulnerable"
): CampaignReport {
  const architecture = analyzeMerchant(mode, "out-of-order-regression");
  const hypothesis = generateHypothesis(architecture, "out-of-order-regression");
  const timeline: TimelineEntry[] = [
    {
      id: "analysis",
      offsetMs: 0,
      kind: "analysis",
      tone: architecture.idempotencyGuard ? "success" : "warning",
      title: "Payment state machine mapped",
      detail: `${architecture.framework} · ${architecture.detectedEvent} → ${architecture.sideEffect}`,
      data: {
        filesScanned: architecture.filesScanned,
        monotonicGuard: architecture.idempotencyGuard
      }
    },
    {
      id: "hypothesis",
      offsetMs: 320,
      kind: "analysis",
      tone: "neutral",
      title: "Ordering hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    }
  ];
  const transitions: StateTransition[] = [];
  let state: PaymentState = "CREATED";

  const capturedValid = verifyRequest(capturedWebhook);
  timeline.push({
    id: "captured-signature",
    offsetMs: 700,
    kind: "webhook",
    tone: capturedValid ? "success" : "danger",
    title: "Captured event signature verified",
    detail: "A newer payment.captured snapshot is delivered before the delayed failure.",
    data: { eventId: capturedWebhook.eventId, createdAt: capturedWebhook.createdAt! }
  });
  const capturedPrevious = state;
  state = "CAPTURED";
  transitions.push({
    id: "state_001",
    event: capturedWebhook.event,
    previous: capturedPrevious,
    next: state,
    outcome: "applied"
  });
  timeline.push({
    id: "captured-applied",
    offsetMs: 920,
    kind: "database",
    tone: "success",
    title: "Payment advanced to CAPTURED",
    detail: "The merchant persisted confirmation that funds were captured.",
    data: { previous: capturedPrevious, current: state }
  });
  timeline.push({
    id: "delayed-failure",
    offsetMs: 1_580,
    kind: "network",
    tone: "warning",
    title: "Older failure event released from delay",
    detail: "A payment.failed snapshot created 60 seconds earlier now reaches the handler.",
    data: { deliveryLagSeconds: 60 }
  });

  const failedValid = verifyRequest(failedWebhook);
  timeline.push({
    id: "failed-signature",
    offsetMs: 1_720,
    kind: "webhook",
    tone: failedValid ? "success" : "danger",
    title: "Delayed failure signature verified",
    detail: "The event is authentic but stale. Signature validity does not imply state validity.",
    data: { eventId: failedWebhook.eventId, createdAt: failedWebhook.createdAt! }
  });

  const failurePrevious = state;
  const ignoreFailure = mode === "protected" && state === "CAPTURED";
  if (!ignoreFailure) state = "FAILED";
  transitions.push({
    id: "state_002",
    event: failedWebhook.event,
    previous: failurePrevious,
    next: state,
    outcome: ignoreFailure ? "ignored" : "applied"
  });
  timeline.push({
    id: "failure-transition",
    offsetMs: 1_940,
    kind: "database",
    tone: ignoreFailure ? "success" : "danger",
    title: ignoreFailure
      ? "Stale state regression blocked"
      : "Captured payment overwritten as FAILED",
    detail: ignoreFailure
      ? "The monotonic transition guard retained CAPTURED and acknowledged the stale event safely."
      : "The last-write-wins handler blindly replaced the confirmed captured state.",
    data: { previous: failurePrevious, current: state }
  });

  const passed = state === "CAPTURED";
  timeline.push({
    id: "invariant-result",
    offsetMs: 2_260,
    kind: "invariant",
    tone: passed ? "success" : "danger",
    title: passed ? "Payment state remained monotonic" : "Payment state invariant violated",
    detail: passed
      ? "A captured payment remained CAPTURED after the delayed failure arrived."
      : "The final merchant state is FAILED even though Razorpay already reported CAPTURED.",
    data: { expected: "CAPTURED", observed: state }
  });

  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "out-of-order-regression",
    execution: {
      kind: "deterministic-model",
      target: "PaymentStateModel",
      transport: "in-process",
      requests: 2,
      stateReads: 1
    },
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 2_260,
    architecture,
    hypothesis,
    timeline,
    invariants: [
      {
        id: "INV-002",
        name: "Captured state is monotonic",
        expression: "captured(P) ⇒ final_status(P) = CAPTURED",
        expected: "CAPTURED",
        observed: state,
        passed
      }
    ],
    fulfilments: [],
    evidenceTable: {
      title: "Payment state transitions",
      columns: [
        { key: "event", label: "EVENT" },
        { key: "previous", label: "PREVIOUS" },
        { key: "next", label: "FINAL" },
        { key: "outcome", label: "OUTCOME" }
      ],
      rows: transitions.map((transition) => ({
        _id: transition.id,
        _tone:
          transition.next === "FAILED"
            ? "danger"
            : transition.outcome === "ignored"
              ? "success"
              : "neutral",
        _badge:
          transition.next === "FAILED"
            ? "REGRESSION"
            : transition.outcome === "ignored"
              ? "BLOCKED"
              : "",
        event: transition.event,
        previous: transition.previous,
        next: transition.next,
        outcome: transition.outcome
      }))
    },
    finding: passed
      ? {
          severity: "none",
          title: "Captured payment resisted stale state",
          whatBroke: "Nothing. The delayed failure could not regress the confirmed payment.",
          whyItBroke: "The handler enforced a monotonic transition rule before writing state.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 state inconsistency exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep CAPTURED monotonic and record stale events for audit without applying them."
        }
      : {
          severity: "critical",
          title: "Captured payment regressed to failed",
          whatBroke: "The merchant now considers a successfully captured payment unpaid.",
          whyItBroke:
            "The handler used delivery order as business chronology and blindly applied an older failure snapshot after capture.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.00 paid order is now at risk of non-fulfilment or incorrect recovery",
          reproduction: hypothesis.faultPlan,
          suggestedFix:
            "Enforce monotonic payment transitions: CAPTURED must not transition back to FAILED."
        },
    resilienceScore: passed ? 97 : 38
  };
}
