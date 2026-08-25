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

const webhook: PaymentWebhook = {
  eventId: "evt_Q8m4Forged",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_926_520
};

export function runForgedWebhookCampaign(
  mode: ProtectionMode = "vulnerable"
): CampaignReport {
  const architecture = analyzeMerchant(mode, "forged-webhook");
  const hypothesis = generateHypothesis(architecture, "forged-webhook");
  const signed = createSignedWebhookRequest(webhook);
  const forgedRawBody = signed.rawBody.replace('"amount":50000', '"amount":50001');
  const signatureValid = verifyRazorpayWebhook(
    forgedRawBody,
    signed.headers["x-razorpay-signature"],
    demoWebhookSecret
  );
  const protectedMode = mode === "protected";
  const accepted = !protectedMode;
  const responseStatus = accepted ? 200 : 401;
  const fulfilments: Fulfilment[] = accepted
    ? [{
        id: "ful_forged_001",
        paymentId: webhook.paymentId,
        orderId: webhook.orderId,
        amount: 50_001,
        createdAt: new Date(Date.UTC(2026, 7, 25, 6, 0, 0, 900)).toISOString()
      }]
    : [];
  const passed = !accepted && fulfilments.length === 0 && !signatureValid;
  const timeline: TimelineEntry[] = [
    {
      id: "analysis",
      offsetMs: 0,
      kind: "analysis",
      tone: protectedMode ? "success" : "warning",
      title: "Webhook trust boundary mapped",
      detail: `${architecture.framework} · raw request → ${architecture.sideEffect}`,
      data: { signatureVerification: protectedMode, filesScanned: architecture.filesScanned }
    },
    {
      id: "hypothesis",
      offsetMs: 240,
      kind: "analysis",
      tone: "neutral",
      title: "Authenticity hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    },
    {
      id: "signed",
      offsetMs: 480,
      kind: "webhook",
      tone: "success",
      title: "Valid Razorpay-shaped capture signed",
      detail: "PayChaos created a valid HMAC for the original byte-exact request body.",
      data: { eventId: webhook.eventId, originalAmount: webhook.amount }
    },
    {
      id: "tampered",
      offsetMs: 650,
      kind: "network",
      tone: "warning",
      title: "Raw payment amount modified after signing",
      detail: "The amount changed by one paise while the stale signature header remained unchanged.",
      data: { forgedAmount: 50_001, signatureValid }
    },
    {
      id: "delivery",
      offsetMs: 900,
      kind: "webhook",
      tone: accepted ? "danger" : "success",
      title: accepted ? "Forged capture reached business logic" : "Forged capture rejected at ingress",
      detail: accepted
        ? "The handler returned HTTP 200 and created a fulfilment without authenticating the payload."
        : "Raw-body HMAC verification returned HTTP 401 before any business write.",
      data: { responseStatus, fulfilmentWrites: fulfilments.length }
    },
    {
      id: "invariant",
      offsetMs: 1_160,
      kind: "invariant",
      tone: passed ? "success" : "danger",
      title: passed ? "Authenticity invariant preserved" : "Authenticity invariant violated",
      detail: passed
        ? "The invalid signature created zero merchant-side value."
        : "An invalid signature created one fulfilment without a successful payment.",
      data: { expectedWrites: 0, observedWrites: fulfilments.length }
    }
  ];

  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "forged-webhook",
    execution: {
      kind: "deterministic-model",
      target: "SignatureBoundaryAdapter",
      transport: "in-process",
      requests: 1,
      stateReads: 1
    },
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 1_160,
    architecture,
    hypothesis,
    timeline,
    invariants: [{
      id: "INV-005",
      name: "Authentic payment events only",
      expression: "invalid_signature(E) ⇒ count(side_effects(E)) = 0",
      expected: "0",
      observed: String(fulfilments.length),
      passed
    }],
    fulfilments,
    evidenceTable: {
      title: "Forged delivery observation",
      columns: [
        { key: "event", label: "EVENT ID" },
        { key: "signature", label: "SIGNATURE" },
        { key: "response", label: "RESPONSE" },
        { key: "writes", label: "FULFILMENT WRITES" }
      ],
      rows: [{
        _id: "forged_attempt_001",
        _tone: passed ? "success" : "danger",
        _badge: passed ? "REJECTED" : "FORGED WRITE",
        event: webhook.eventId,
        signature: "invalid after tamper",
        response: `HTTP ${responseStatus}`,
        writes: fulfilments.length
      }]
    },
    finding: passed
      ? {
          severity: "none",
          title: "Tampered webhook stopped before business logic",
          whatBroke: "Nothing. The invalid raw-body signature produced no merchant-side state.",
          whyItBroke: "The handler compared the provided signature against an HMAC of the exact received bytes.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 unauthorized fulfilment exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep signature verification before parsing, acknowledgement, or business writes."
        }
      : {
          severity: "critical",
          title: "Forged capture created a fulfilment",
          whatBroke: "A tampered request created merchant-side value without an authentic payment event.",
          whyItBroke: "The handler trusted Razorpay-shaped JSON without verifying the raw-body HMAC signature.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.01 unauthorized fulfilment exposure in this run",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Verify x-razorpay-signature against the untouched raw body before executing business logic."
        },
    resilienceScore: passed ? 99 : 18
  };
}
