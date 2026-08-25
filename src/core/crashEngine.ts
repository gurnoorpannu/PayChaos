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
  eventId: "evt_Q8m4Crash",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_925_860
};

export function runCrashRecoveryCampaign(
  mode: ProtectionMode = "vulnerable"
): CampaignReport {
  const architecture = analyzeMerchant(mode, "crash-before-side-effect");
  const hypothesis = generateHypothesis(architecture, "crash-before-side-effect");
  const request = createSignedWebhookRequest(capturedWebhook);
  const signatureValid = verifyRazorpayWebhook(
    request.rawBody,
    request.headers["x-razorpay-signature"],
    demoWebhookSecret
  );
  const protectedMode = mode === "protected";
  const fulfilment: Fulfilment = {
    id: "ful_001",
    paymentId: capturedWebhook.paymentId,
    orderId: capturedWebhook.orderId,
    amount: capturedWebhook.amount,
    createdAt: new Date(Date.UTC(2026, 7, 23, 6, 30, 0, 900)).toISOString()
  };
  let shipmentJobs = 0;
  const outboxCreated = protectedMode;

  const timeline: TimelineEntry[] = [
    {
      id: "analysis",
      offsetMs: 0,
      kind: "analysis",
      tone: protectedMode ? "success" : "warning",
      title: "Durability boundary mapped",
      detail: `${architecture.framework} · ${architecture.detectedEvent} → ${architecture.sideEffect}`,
      data: { filesScanned: architecture.filesScanned, durableOutbox: protectedMode }
    },
    {
      id: "hypothesis",
      offsetMs: 310,
      kind: "analysis",
      tone: "neutral",
      title: "Crash-window hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    },
    {
      id: "signature",
      offsetMs: 680,
      kind: "webhook",
      tone: signatureValid ? "success" : "danger",
      title: "Captured event signature verified",
      detail: "The signed payment.captured event entered the merchant handler.",
      data: { eventId: capturedWebhook.eventId, signatureValid }
    },
    {
      id: "commit",
      offsetMs: 900,
      kind: "database",
      tone: "success",
      title: protectedMode
        ? "Event, fulfilment, and outbox intent committed"
        : "Event claim and fulfilment committed",
      detail: protectedMode
        ? "The shipment intent is durable in the same transaction as the payment side effect."
        : "The database transaction completed before shipment dispatch began.",
      data: { eventClaimed: true, fulfilmentCreated: true, outboxCreated }
    },
    {
      id: "crash",
      offsetMs: 1_050,
      kind: "network",
      tone: "danger",
      title: "Merchant process crashed before dispatch",
      detail: "The process terminated after commit and before queueShipment could complete.",
      data: { processExit: 137, shipmentJobs }
    },
    {
      id: "restart",
      offsetMs: 1_640,
      kind: "network",
      tone: "warning",
      title: "Merchant restarted",
      detail: protectedMode
        ? "The outbox worker resumed and searched for pending durable intents."
        : "No durable record describes the shipment call that was interrupted.",
      data: { pendingOutboxRows: outboxCreated ? 1 : 0 }
    }
  ];

  if (protectedMode) {
    shipmentJobs = 1;
    timeline.push({
      id: "outbox-recovery",
      offsetMs: 1_880,
      kind: "database",
      tone: "success",
      title: "Outbox worker recovered the shipment",
      detail: "The pending shipment.requested row was dispatched with its unique outbox key.",
      data: { shipmentJobs, outboxStatus: "dispatched" }
    });
  } else {
    timeline.push({
      id: "missing-intent",
      offsetMs: 1_880,
      kind: "database",
      tone: "danger",
      title: "No shipment intent could be recovered",
      detail: "Database state says the event was processed, but no durable dispatch record exists.",
      data: { shipmentJobs, recoverableIntents: 0 }
    });
  }

  timeline.push(
    {
      id: "retry",
      offsetMs: 2_300,
      kind: "webhook",
      tone: "neutral",
      title: "Razorpay retried the captured event",
      detail: "The identical event ID reached the restarted handler after the lost acknowledgement.",
      data: { eventId: capturedWebhook.eventId }
    },
    {
      id: "dedupe",
      offsetMs: 2_460,
      kind: "database",
      tone: protectedMode ? "success" : "warning",
      title: "Existing event claim converted retry to no-op",
      detail: protectedMode
        ? "No duplicate fulfilment was created; the outbox worker already restored the side effect."
        : "No duplicate fulfilment was created, but the missing shipment was not repaired either.",
      data: { duplicateFulfilments: 0, shipmentJobs }
    }
  );

  const passed = shipmentJobs === 1;
  timeline.push({
    id: "invariant",
    offsetMs: 2_780,
    kind: "invariant",
    tone: passed ? "success" : "danger",
    title: passed ? "Durable side-effect invariant preserved" : "Paid order stranded after crash",
    detail: passed
      ? "One captured payment produced exactly one recoverable shipment job."
      : "The payment and fulfilment were committed, but zero shipment jobs exist after restart and retry.",
    data: { expected: 1, observed: shipmentJobs }
  });

  const rows = [
    {
      _id: "checkpoint_commit",
      _tone: "neutral",
      _badge: "",
      checkpoint: "database commit",
      event: "claimed",
      fulfilment: "created",
      outbox: outboxCreated ? "pending" : "missing",
      shipment: 0
    },
    {
      _id: "checkpoint_restart",
      _tone: protectedMode ? "success" : "danger",
      _badge: protectedMode ? "RECOVERED" : "STRANDED",
      checkpoint: "after restart",
      event: "claimed",
      fulfilment: "created",
      outbox: protectedMode ? "dispatched" : "missing",
      shipment: shipmentJobs
    }
  ];

  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "crash-before-side-effect",
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 2_780,
    architecture,
    hypothesis,
    timeline,
    invariants: [
      {
        id: "INV-003",
        name: "Durable fulfilment dispatch",
        expression: "captured(P) ⇒ count(shipment_jobs(order(P))) = 1",
        expected: "1",
        observed: String(shipmentJobs),
        passed
      }
    ],
    fulfilments: [fulfilment],
    evidenceTable: {
      title: "Crash recovery checkpoints",
      columns: [
        { key: "checkpoint", label: "CHECKPOINT" },
        { key: "event", label: "EVENT" },
        { key: "fulfilment", label: "FULFILMENT" },
        { key: "outbox", label: "OUTBOX" },
        { key: "shipment", label: "SHIPMENT JOBS" }
      ],
      rows
    },
    finding: passed
      ? {
          severity: "none",
          title: "Shipment recovered after process crash",
          whatBroke: "Nothing. The committed outbox intent survived and was dispatched after restart.",
          whyItBroke: "The database transaction made payment state and shipment intent atomic.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 stranded-order exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep the transactional outbox key unique and retry pending rows until acknowledged."
        }
      : {
          severity: "critical",
          title: "Paid order was never sent to fulfilment",
          whatBroke: "The payment and local fulfilment exist, but the shipment queue has no job.",
          whyItBroke:
            "The irreversible database commit and external queue call were separated by a crash window. Event deduplication then suppressed the retry that could have repaired it.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.00 captured order is stranded with no shipment work",
          reproduction: hypothesis.faultPlan,
          suggestedFix:
            "Write a uniquely keyed shipment intent to a transactional outbox beside the fulfilment, then dispatch it with a restart-safe worker."
        },
    resilienceScore: passed ? 98 : 34
  };
}
