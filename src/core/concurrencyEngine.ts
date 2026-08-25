import { randomUUID } from "node:crypto";
import { analyzeMerchant, generateHypothesis } from "./analyzer.js";
import {
  createSignedWebhookRequest,
  demoWebhookSecret,
  verifyRazorpayWebhook
} from "./razorpay.js";
import type {
  CampaignReport,
  Fulfilment,
  PaymentWebhook,
  ProtectionMode,
  TimelineEntry
} from "./types.js";

const capturedWebhook: PaymentWebhook = {
  eventId: "evt_Q8m4Race",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_925_920
};

function fulfilment(id: string, milliseconds: number): Fulfilment {
  return {
    id,
    paymentId: capturedWebhook.paymentId,
    orderId: capturedWebhook.orderId,
    amount: capturedWebhook.amount,
    createdAt: new Date(Date.UTC(2026, 7, 25, 5, 0, 0, milliseconds)).toISOString()
  };
}

export function runConcurrentDeliveryCampaign(
  mode: ProtectionMode = "vulnerable"
): CampaignReport {
  const architecture = analyzeMerchant(mode, "concurrent-delivery-race");
  const hypothesis = generateHypothesis(architecture, "concurrent-delivery-race");
  const request = createSignedWebhookRequest(capturedWebhook);
  const signatureValid = verifyRazorpayWebhook(
    request.rawBody,
    request.headers["x-razorpay-signature"],
    demoWebhookSecret
  );
  const protectedMode = mode === "protected";
  const fulfilments = protectedMode
    ? [fulfilment("ful_worker_a", 820)]
    : [fulfilment("ful_worker_a", 820), fulfilment("ful_worker_b", 824)];

  const timeline: TimelineEntry[] = [
    {
      id: "analysis",
      offsetMs: 0,
      kind: "analysis",
      tone: protectedMode ? "success" : "warning",
      title: "Idempotency boundary mapped",
      detail: `${architecture.framework} · ${architecture.detectedEvent} → ${architecture.sideEffect}`,
      data: { filesScanned: architecture.filesScanned, atomicClaim: protectedMode }
    },
    {
      id: "hypothesis",
      offsetMs: 260,
      kind: "analysis",
      tone: "neutral",
      title: "Concurrency hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    },
    {
      id: "fork",
      offsetMs: 520,
      kind: "network",
      tone: "warning",
      title: "Identical delivery forked to two workers",
      detail: "The scheduler released two copies of the same signed event at the same virtual instant.",
      data: { workers: 2, eventId: capturedWebhook.eventId }
    },
    {
      id: "signatures",
      offsetMs: 610,
      kind: "webhook",
      tone: signatureValid ? "success" : "danger",
      title: "Both workers verified the Razorpay signature",
      detail: "The payload and x-razorpay-event-id are byte-identical on both deliveries.",
      data: { signatureValid, identicalPayloads: true }
    },
    {
      id: "concurrent-read",
      offsetMs: 760,
      kind: "database",
      tone: protectedMode ? "neutral" : "danger",
      title: protectedMode
        ? "Workers contended on one atomic event claim"
        : "Both workers observed no processed event",
      detail: protectedMode
        ? "Database uniqueness, not request timing, decides which transaction owns the event."
        : "The scheduler paused both workers after their check and before either insert.",
      data: { workerARead: "missing", workerBRead: "missing" }
    },
    {
      id: "worker-a",
      offsetMs: 820,
      kind: "database",
      tone: "success",
      title: "Worker A committed fulfilment",
      detail: protectedMode
        ? "Worker A atomically claimed the event ID and created the fulfilment."
        : "Worker A acted on its earlier not-processed decision.",
      data: { worker: "A", totalFulfilments: 1 }
    },
    {
      id: "worker-b",
      offsetMs: 824,
      kind: "database",
      tone: protectedMode ? "success" : "danger",
      title: protectedMode
        ? "Worker B lost the unique-claim race safely"
        : "Worker B committed a duplicate fulfilment",
      detail: protectedMode
        ? "The unique event constraint rejected the second claim, so the whole transaction became a no-op."
        : "Worker B used the same stale read result and repeated the irreversible side effect.",
      data: { worker: "B", totalFulfilments: fulfilments.length }
    }
  ];

  const passed = fulfilments.length <= 1;
  timeline.push({
    id: "invariant",
    offsetMs: 1_080,
    kind: "invariant",
    tone: passed ? "success" : "danger",
    title: passed ? "Concurrent delivery invariant preserved" : "Concurrency invariant violated",
    detail: passed
      ? "Two simultaneous deliveries produced one fulfilment."
      : "Two simultaneous deliveries of one event produced two fulfilments.",
    data: { expectedMaximum: 1, observed: fulfilments.length }
  });

  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "concurrent-delivery-race",
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 1_080,
    architecture,
    hypothesis,
    timeline,
    invariants: [
      {
        id: "INV-004",
        name: "Atomic concurrent fulfilment",
        expression: "concurrent(deliveries(E)) ⇒ count(fulfilments(payment(E))) <= 1",
        expected: "≤ 1",
        observed: String(fulfilments.length),
        passed
      }
    ],
    fulfilments,
    evidenceTable: {
      title: "Concurrent worker outcomes",
      columns: [
        { key: "worker", label: "WORKER" },
        { key: "initialRead", label: "EVENT READ" },
        { key: "claim", label: "CLAIM" },
        { key: "outcome", label: "OUTCOME" }
      ],
      rows: [
        {
          _id: "worker_a",
          _tone: "neutral",
          _badge: "WINNER",
          worker: "A",
          initialRead: "missing",
          claim: "committed",
          outcome: "fulfilment created"
        },
        {
          _id: "worker_b",
          _tone: protectedMode ? "success" : "danger",
          _badge: protectedMode ? "BLOCKED" : "DUPLICATE",
          worker: "B",
          initialRead: "missing",
          claim: protectedMode ? "unique conflict" : "committed",
          outcome: protectedMode ? "safe no-op" : "fulfilment created"
        }
      ]
    },
    finding: passed
      ? {
          severity: "none",
          title: "Database uniqueness serialized both workers",
          whatBroke: "Nothing. Only one concurrent delivery could own the event claim.",
          whyItBroke: "The claim and fulfilment shared a transaction backed by a unique event ID constraint.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 concurrent duplicate exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep the unique event claim and fulfilment write in one transaction."
        }
      : {
          severity: "critical",
          title: "The idempotency check lost a concurrency race",
          whatBroke: "Two workers created fulfilments for the same captured payment.",
          whyItBroke:
            "The read-before-write guard was not atomic. Both workers observed the same empty state and independently committed business work.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.00 duplicate fulfilment exposure within a 4 ms race window",
          reproduction: hypothesis.faultPlan,
          suggestedFix:
            "Claim x-razorpay-event-id with a database UNIQUE constraint inside the same transaction as fulfilment creation."
        },
    resilienceScore: passed ? 99 : 31
  };
}
