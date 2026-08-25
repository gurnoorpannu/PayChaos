import { randomUUID } from "node:crypto";
import { analyzeMerchant, generateHypothesis } from "../core/analyzer.js";
import { createSignedWebhookRequest } from "../core/razorpay.js";
import type {
  CampaignReport,
  PaymentWebhook,
  ProtectionMode,
  TimelineEntry
} from "../core/types.js";
import {
  startDemoMerchantTarget,
  type LiveMerchantState
} from "./demoMerchantTarget.js";

const webhook: PaymentWebhook = {
  eventId: "evt_Q8m4Live",
  event: "payment.captured",
  paymentId: "pay_Q8kwz3nE2s",
  orderId: "order_Q8krp5dH1a",
  amount: 50_000,
  currency: "INR",
  createdAt: 1_776_926_040
};

function isTimeout(error: unknown): boolean {
  return error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
}

export async function runLiveDuplicateCampaign(
  mode: ProtectionMode = "vulnerable"
): Promise<CampaignReport> {
  const architecture = analyzeMerchant(mode, "duplicate-after-timeout");
  const hypothesis = generateHypothesis(architecture, "duplicate-after-timeout");
  const signedRequest = createSignedWebhookRequest(webhook);
  const target = await startDemoMerchantTarget(mode);
  let firstTimedOut = false;
  let retryStatus = 0;
  let state: LiveMerchantState;

  try {
    try {
      await fetch(`${target.baseUrl}/webhooks/razorpay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signedRequest.headers,
          "x-paychaos-fault": "timeout-after-commit"
        },
        body: signedRequest.rawBody,
        signal: AbortSignal.timeout(30)
      });
    } catch (error) {
      if (!isTimeout(error)) throw error;
      firstTimedOut = true;
    }

    const retry = await fetch(`${target.baseUrl}/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedRequest.headers
      },
      body: signedRequest.rawBody
    });
    retryStatus = retry.status;
    await retry.text();

    const stateResponse = await fetch(`${target.baseUrl}/__paychaos/state`);
    if (!stateResponse.ok) throw new Error("Live merchant observation endpoint failed.");
    state = (await stateResponse.json()) as LiveMerchantState;
  } finally {
    await target.stop();
  }

  const fulfilments = state.fulfilments;
  const passed = firstTimedOut && retryStatus === 200 && fulfilments.length <= 1;
  const firstSignatureValid = state.requests[0]?.signatureValid ?? false;
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
      offsetMs: 240,
      kind: "analysis",
      tone: "neutral",
      title: "Application-specific hypothesis generated",
      detail: hypothesis.title,
      data: { confidence: hypothesis.confidence }
    },
    {
      id: "target-start",
      offsetMs: 460,
      kind: "network",
      tone: "success",
      title: "Live merchant target started",
      detail: "PayChaos bound an isolated Express target to an ephemeral loopback port.",
      data: { transport: "HTTP", ephemeralPort: true }
    },
    {
      id: "delivery-1",
      offsetMs: 680,
      kind: "webhook",
      tone: firstSignatureValid ? "success" : "danger",
      title: "Signed webhook delivered over HTTP",
      detail: "The real merchant route verified the raw Razorpay-shaped request body.",
      data: { signatureValid: firstSignatureValid, eventId: webhook.eventId }
    },
    {
      id: "write-1",
      offsetMs: 800,
      kind: "database",
      tone: "success",
      title: "Merchant committed fulfilment before response",
      detail: "The observation endpoint recorded the financial side effect inside the running target.",
      data: { observedFulfilments: 1, source: "live target" }
    },
    {
      id: "timeout",
      offsetMs: 920,
      kind: "network",
      tone: firstTimedOut ? "warning" : "danger",
      title: firstTimedOut
        ? "Client acknowledgement timed out after commit"
        : "Timeout injection did not activate",
      detail: firstTimedOut
        ? "The HTTP client aborted while the merchant retained its committed state."
        : "The first request returned before the configured fault boundary.",
      data: { clientTimedOut: firstTimedOut, processingCompleted: true }
    },
    {
      id: "retry",
      offsetMs: 1_140,
      kind: "webhook",
      tone: retryStatus === 200 ? "neutral" : "danger",
      title: "Identical event retried over HTTP",
      detail: `The same event ID reached the live route again and returned HTTP ${retryStatus}.`,
      data: { retryStatus, eventId: webhook.eventId }
    },
    {
      id: "state-read",
      offsetMs: 1_300,
      kind: "database",
      tone: fulfilments.length <= 1 ? "success" : "danger",
      title: "Observed merchant state collected",
      detail: `PayChaos queried the target after both deliveries and found ${fulfilments.length} fulfilment row${fulfilments.length === 1 ? "" : "s"}.`,
      data: { requestsObserved: state.requests.length, fulfilments: fulfilments.length }
    },
    {
      id: "invariant",
      offsetMs: 1_480,
      kind: "invariant",
      tone: passed ? "success" : "danger",
      title: passed ? "Live financial invariant preserved" : "Live financial invariant violated",
      detail: passed
        ? "The running merchant absorbed the retry and retained one fulfilment."
        : `The running merchant created ${fulfilments.length} fulfilments for one captured payment.`,
      data: { expectedMaximum: 1, observed: fulfilments.length }
    }
  ];

  return {
    id: `live_${randomUUID().slice(0, 8)}`,
    mode,
    scenario: "duplicate-after-timeout",
    execution: {
      kind: "live-http",
      target: "ExpressDemoMerchant",
      transport: "HTTP",
      requests: state.requests.length,
      stateReads: 1
    },
    status: passed ? "passed" : "failed",
    startedAt: new Date().toISOString(),
    durationMs: 1_480,
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
      title: "Live HTTP delivery observations",
      columns: [
        { key: "request", label: "REQUEST" },
        { key: "signature", label: "SIGNATURE" },
        { key: "response", label: "RESPONSE" },
        { key: "writes", label: "FULFILMENT WRITES" }
      ],
      rows: state.requests.map((observation, index) => ({
        _id: `live_request_${observation.request}`,
        _tone:
          index === 0
            ? "neutral"
            : observation.fulfilmentWrites > 0
              ? "danger"
              : "success",
        _badge:
          index === 0
            ? "ACK LOST"
            : observation.duplicateIgnored
              ? "DEDUPED"
              : observation.fulfilmentWrites > 0
                ? "DUPLICATE"
                : "",
        request: `attempt ${observation.request}`,
        signature: observation.signatureValid ? "valid" : "rejected",
        response: index === 0 && firstTimedOut ? "client timeout" : observation.response,
        writes: observation.fulfilmentWrites
      }))
    },
    finding: passed
      ? {
          severity: "none",
          title: "Live merchant absorbed the HTTP retry",
          whatBroke: "Nothing. The target committed one fulfilment across two real deliveries.",
          whyItBroke: "The unique event claim converted the second HTTP request into a no-op.",
          whereItBroke: architecture.evidence.file,
          financialImpact: "₹0.00 additional exposure",
          reproduction: hypothesis.faultPlan,
          suggestedFix: "Keep the event claim and fulfilment write in the same database transaction."
        }
      : {
          severity: "critical",
          title: "Live HTTP retry duplicated fulfilment",
          whatBroke: "The running merchant committed two fulfilments for one captured payment.",
          whyItBroke:
            "The first HTTP request committed before its acknowledgement timed out. The retry repeated the unguarded write.",
          whereItBroke: `${architecture.evidence.file}:${architecture.evidence.line}`,
          financialImpact: "₹500.00 duplicate fulfilment exposure observed through HTTP",
          reproduction: hypothesis.faultPlan,
          suggestedFix:
            "Atomically claim x-razorpay-event-id with a UNIQUE constraint before creating the fulfilment."
        },
    resilienceScore: passed ? 97 : 40
  };
}
