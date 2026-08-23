import {
  protectedMerchantSource,
  protectedStateSource,
  vulnerableMerchantSource,
  vulnerableStateSource
} from "./sample.js";
import type {
  ArchitectureAnalysis,
  Hypothesis,
  ProtectionMode,
  ScenarioId
} from "./types.js";

export function analyzeMerchant(
  mode: ProtectionMode,
  scenario: ScenarioId = "duplicate-after-timeout"
): ArchitectureAnalysis {
  const stateScenario = scenario === "out-of-order-regression";
  const source = stateScenario
    ? mode === "protected"
      ? protectedStateSource
      : vulnerableStateSource
    : mode === "protected"
      ? protectedMerchantSource
      : vulnerableMerchantSource;
  const routeMatch = source.match(/router\.post\("([^"]+)"/);
  const eventMatch = source.match(/event === "([^"]+)"/);
  const hasEventHeader = source.includes("x-razorpay-event-id");
  const hasUniqueClaim = source.includes("UNIQUE constraint");
  const hasIdempotencyGuard = hasEventHeader && hasUniqueClaim;
  const fulfilmentLine = source
    .split("\n")
    .findIndex((line) =>
      line.includes(stateScenario ? "payment.update" : "fulfilment.create")
    );
  const hasMonotonicGuard = source.includes("CAPTURED is monotonic");
  const protectedBoundary = stateScenario ? hasMonotonicGuard : hasIdempotencyGuard;

  return {
    framework: "Express + Prisma",
    filesScanned: 12,
    webhookRoute: routeMatch?.[1] ?? "unknown",
    detectedEvent: stateScenario ? "payment.captured + payment.failed" : eventMatch?.[1] ?? "unknown",
    sideEffect: stateScenario
      ? "Updates the persisted payment status"
      : "Creates a fulfilment and queues a shipment",
    idempotencyGuard: protectedBoundary,
    confidence: protectedBoundary ? 0.96 : 0.98,
    evidence: {
      file: "src/routes/razorpay-webhook.ts",
      line: fulfilmentLine + 1,
      excerpt: stateScenario
        ? hasMonotonicGuard
          ? "if (current.status === \"CAPTURED\" && event === \"payment.failed\") return"
          : "payment.failed → data: { status: \"FAILED\" }"
        : hasIdempotencyGuard
          ? "UNIQUE(eventId) claimed inside the fulfilment transaction"
          : "prisma.fulfilment.create({ paymentId: payment.id })"
    },
    nodes: [
      {
        id: "razorpay",
        label: "Razorpay",
        detail: "payment.captured",
        kind: "external"
      },
      {
        id: "webhook",
        label: "Webhook route",
        detail: routeMatch?.[1] ?? "/webhooks/razorpay",
        kind: "entry"
      },
      {
        id: "handler",
        label: stateScenario
          ? hasMonotonicGuard
            ? "State transition guard"
            : "Last-write-wins handler"
          : hasIdempotencyGuard
            ? "Atomic event claim"
            : "Event handler",
        detail: stateScenario
          ? hasMonotonicGuard
            ? "Captured state cannot regress"
            : "No monotonic state guard"
          : hasIdempotencyGuard
            ? "Unique event ID guard"
            : "No idempotency guard",
        kind: "logic",
        risk: !protectedBoundary
      },
      {
        id: "database",
        label: stateScenario ? "Payments" : "Fulfilments",
        detail: stateScenario ? "UPDATE status" : "INSERT + queue shipment",
        kind: "database"
      }
    ]
  };
}

export function generateHypothesis(
  analysis: ArchitectureAnalysis,
  scenario: ScenarioId = "duplicate-after-timeout"
): Hypothesis {
  const guarded = analysis.idempotencyGuard;

  if (scenario === "out-of-order-regression") {
    return {
      id: "HYP-002",
      title: guarded
        ? "A delayed failure should not regress a captured payment"
        : "A delayed failure can overwrite a captured payment",
      reasoning: guarded
        ? "The handler treats CAPTURED as a monotonic terminal state and ignores a later-delivered failure snapshot for the same payment."
        : "Both webhook branches overwrite the stored status without comparing state precedence or event chronology. A delayed payment.failed event can arrive after capture and become the final local state.",
      faultPlan: ["Capture", "Delay failure", "Deliver stale event", "Inspect state"],
      invariant: "captured(P) ⇒ final_status(P) = CAPTURED",
      confidence: guarded ? 0.95 : 0.98
    };
  }

  return {
    id: "HYP-001",
    title: guarded
      ? "Duplicate delivery should be absorbed by the event claim"
      : "A post-commit timeout can trigger duplicate fulfilment",
    reasoning: guarded
      ? "The handler atomically claims x-razorpay-event-id before creating a fulfilment. A retry should observe the existing claim and become a no-op."
      : "The handler performs an irreversible fulfilment write before acknowledging the webhook, but no unique event claim was detected. If the acknowledgement is lost, at-least-once delivery can repeat the side effect.",
    faultPlan: ["Deliver", "Commit", "Timeout response", "Retry same event"],
    invariant: "count(fulfilments where payment_id = P) <= 1",
    confidence: guarded ? 0.94 : 0.97
  };
}
