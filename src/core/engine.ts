import { randomUUID } from "node:crypto";
import { analyzeMerchant, generateHypothesis } from "./analyzer.js";
import { MerchantSimulator } from "./merchant.js";
import { createSignedWebhookRequest } from "./razorpay.js";
import type {
  CampaignReport,
  PaymentWebhook,
  ProtectionMode,
  TimelineEntry
} from "./types.js";

const webhook: PaymentWebhook = {
  eventId: "evt_Q8m4Yk2pL7",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR"
};

export function runDuplicateAfterTimeoutCampaign(
  mode: ProtectionMode = "vulnerable"
): CampaignReport {
  const architecture = analyzeMerchant(mode, "duplicate-after-timeout");
  const hypothesis = generateHypothesis(architecture, "duplicate-after-timeout");
  const merchant = new MerchantSimulator(mode);
  const signedRequest = createSignedWebhookRequest(webhook);
  const timeline: TimelineEntry[] = [
    {
      id: "analysis",
      offsetMs: 0,
      kind: "analysis",
      tone: architecture.idempotencyGuard ? "success" : "warning",
      title: "Payment architecture mapped",
      detail: `${architecture.framework} · ${architecture.detectedEvent} → ${architecture.sideEffect}`,
      data: {
        filesScanned: architecture.filesScanned,
        idempotencyGuard: architecture.idempotencyGuard
      }
    },
    {
      id: "hypothesis",
      offsetMs: 360,
      kind: "analysis",
      tone: "neutral",
      title: "Application-specific hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    }
  ];

  const firstAttempt = merchant.deliver(signedRequest, 1, timeline);
  if (firstAttempt.timedOut) {
    timeline.push({
      id: "retry-scheduled",
      offsetMs: 1_720,
      kind: "network",
      tone: "warning",
      title: "At-least-once retry scheduled",
      detail: "The same event ID and payload will be delivered again after the missing acknowledgement.",
      data: { eventId: webhook.eventId }
    });
    merchant.deliver(signedRequest, 2, timeline);
  }

  const fulfilments = merchant.snapshot();
  const passed = fulfilments.length <= 1;
  timeline.push({
    id: "invariant-result",
    offsetMs: 3_240,
    kind: "invariant",
    tone: passed ? "success" : "danger",
    title: passed ? "Financial invariant preserved" : "Financial invariant violated",
    detail: passed
      ? "One successful payment produced exactly one fulfilment after retry."
      : `One successful payment produced ${fulfilments.length} fulfilments.`,
    data: { expectedMaximum: 1, observed: fulfilments.length }
  });

  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "duplicate-after-timeout",
    execution: {
      kind: "deterministic-model",
      target: "MerchantSimulator",
      transport: "in-process",
      requests: 2,
      stateReads: 1
    },
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 3_240,
    architecture,
    hypothesis,
    timeline,
    invariants: [
      {
        id: "INV-001",
        name: "Exactly-once fulfilment",
        expression: "fulfilments(payment_id).count <= 1",
        expected: "≤ 1",
        observed: String(fulfilments.length),
        passed
      }
    ],
    fulfilments,
    evidenceTable: {
      title: "Fulfilment records",
      columns: [
        { key: "id", label: "ID" },
        { key: "payment", label: "PAYMENT" },
        { key: "order", label: "ORDER" },
        { key: "amount", label: "AMOUNT" }
      ],
      rows: fulfilments.map((fulfilment, index) => ({
        _id: fulfilment.id,
        _tone: index > 0 ? "danger" : "neutral",
        _badge: index > 0 ? "DUPLICATE" : "",
        id: fulfilment.id,
        payment: fulfilment.paymentId,
        order: fulfilment.orderId,
        amount: `₹${(fulfilment.amount / 100).toFixed(2)}`
      }))
    },
    finding: passed
      ? {
          severity: "none",
          title: "Duplicate delivery was handled safely",
          whatBroke: "Nothing. The retry did not repeat the business side effect.",
          whyItBroke: "The unique event claim converted the repeated delivery into a no-op.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 additional exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep the event claim and fulfilment write in the same database transaction."
        }
      : {
          severity: "critical",
          title: "One payment created two fulfilments",
          whatBroke: "The same captured payment queued fulfilment twice.",
          whyItBroke:
            "The first delivery committed before its acknowledgement was lost. The retry repeated the unguarded side effect.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.00 duplicate fulfilment exposure in this run",
          reproduction: hypothesis.faultPlan,
          suggestedFix:
            "Atomically claim x-razorpay-event-id with a UNIQUE constraint before creating the fulfilment."
        },
    resilienceScore: passed ? 96 : 42
  };
}
