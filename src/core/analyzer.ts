import {
  protectedMerchantSource,
  vulnerableMerchantSource
} from "./sample.js";
import type {
  ArchitectureAnalysis,
  Hypothesis,
  ProtectionMode
} from "./types.js";

export function analyzeMerchant(mode: ProtectionMode): ArchitectureAnalysis {
  const source = mode === "protected" ? protectedMerchantSource : vulnerableMerchantSource;
  const routeMatch = source.match(/router\.post\("([^"]+)"/);
  const eventMatch = source.match(/event === "([^"]+)"/);
  const hasEventHeader = source.includes("x-razorpay-event-id");
  const hasUniqueClaim = source.includes("UNIQUE constraint");
  const hasIdempotencyGuard = hasEventHeader && hasUniqueClaim;
  const fulfilmentLine = source
    .split("\n")
    .findIndex((line) => line.includes("fulfilment.create"));

  return {
    framework: "Express + Prisma",
    filesScanned: 12,
    webhookRoute: routeMatch?.[1] ?? "unknown",
    detectedEvent: eventMatch?.[1] ?? "unknown",
    sideEffect: "Creates a fulfilment and queues a shipment",
    idempotencyGuard: hasIdempotencyGuard,
    confidence: hasIdempotencyGuard ? 0.96 : 0.98,
    evidence: {
      file: "src/routes/razorpay-webhook.ts",
      line: fulfilmentLine + 1,
      excerpt: hasIdempotencyGuard
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
        label: hasIdempotencyGuard ? "Atomic event claim" : "Event handler",
        detail: hasIdempotencyGuard ? "Unique event ID guard" : "No idempotency guard",
        kind: "logic",
        risk: !hasIdempotencyGuard
      },
      {
        id: "database",
        label: "Fulfilments",
        detail: "INSERT + queue shipment",
        kind: "database"
      }
    ]
  };
}

export function generateHypothesis(analysis: ArchitectureAnalysis): Hypothesis {
  const guarded = analysis.idempotencyGuard;

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
