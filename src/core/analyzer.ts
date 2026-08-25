import {
  protectedCrashSource,
  protectedMerchantSource,
  protectedStateSource,
  vulnerableCrashSource,
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
  const crashScenario = scenario === "crash-before-side-effect";
  const source = crashScenario
    ? mode === "protected"
      ? protectedCrashSource
      : vulnerableCrashSource
    : stateScenario
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
      line.includes(
        stateScenario
          ? "payment.update"
          : crashScenario && mode === "protected"
            ? "outbox.create"
            : crashScenario
              ? "queueShipment"
              : "fulfilment.create"
      )
    );
  const hasMonotonicGuard = source.includes("CAPTURED is monotonic");
  const hasDurableOutbox =
    source.includes("outbox.create") &&
    source.includes("outboxWorker") &&
    source.includes("$transaction");
  const protectedBoundary = crashScenario
    ? hasDurableOutbox
    : stateScenario
      ? hasMonotonicGuard
      : hasIdempotencyGuard;

  return {
    framework: "Express + Prisma",
    filesScanned: 12,
    webhookRoute: routeMatch?.[1] ?? "unknown",
    detectedEvent: stateScenario
      ? "payment.captured + payment.failed"
      : eventMatch?.[1] ?? "payment.captured",
    sideEffect: crashScenario
      ? "Commits fulfilment then dispatches shipment"
      : stateScenario
        ? "Updates the persisted payment status"
        : "Creates a fulfilment and queues a shipment",
    idempotencyGuard: protectedBoundary,
    confidence: protectedBoundary ? 0.96 : 0.98,
    evidence: {
      file: "src/routes/razorpay-webhook.ts",
      line: fulfilmentLine + 1,
      excerpt: crashScenario
        ? hasDurableOutbox
          ? "tx.outbox.create({ key: `shipment:${orderId}` })"
          : "commit fulfilment → queueShipment(orderId)"
        : stateScenario
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
        label: crashScenario
          ? hasDurableOutbox
            ? "Transactional outbox"
            : "Post-commit dispatch"
          : stateScenario
            ? hasMonotonicGuard
              ? "State transition guard"
              : "Last-write-wins handler"
            : hasIdempotencyGuard
              ? "Atomic event claim"
              : "Event handler",
        detail: crashScenario
          ? hasDurableOutbox
            ? "Durable recovery boundary"
            : "No durable handoff"
          : stateScenario
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
        label: crashScenario ? (hasDurableOutbox ? "Outbox worker" : "Shipment queue") : stateScenario ? "Payments" : "Fulfilments",
        detail: crashScenario
          ? hasDurableOutbox
            ? "Retry pending dispatch"
            : "Best-effort call"
          : stateScenario
            ? "UPDATE status"
            : "INSERT + queue shipment",
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

  if (scenario === "crash-before-side-effect") {
    return {
      id: "HYP-003",
      title: guarded
        ? "A durable outbox should recover shipment after a process crash"
        : "A post-commit crash can strand a paid order",
      reasoning: guarded
        ? "The event claim, fulfilment, and shipment intent are committed atomically. A restarted worker can recover the pending outbox row without replaying business state."
        : "The handler commits the event claim and fulfilment before calling the shipment queue. If the process crashes in that gap, a webhook retry sees the claimed event and skips the missing side effect.",
      faultPlan: ["Commit payment", "Crash process", "Restart worker", "Retry webhook"],
      invariant: "captured(P) ⇒ count(shipment_jobs(order(P))) = 1",
      confidence: guarded ? 0.96 : 0.99
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
