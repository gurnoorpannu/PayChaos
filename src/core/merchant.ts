import type {
  Fulfilment,
  PaymentWebhook,
  ProtectionMode,
  TimelineEntry
} from "./types.js";

interface DeliveryResult {
  statusCode: number;
  timedOut: boolean;
  duplicateIgnored: boolean;
}

export class MerchantSimulator {
  private fulfilments: Fulfilment[] = [];
  private processedEvents = new Set<string>();

  constructor(private readonly mode: ProtectionMode) {}

  deliver(
    webhook: PaymentWebhook,
    attempt: number,
    timeline: TimelineEntry[]
  ): DeliveryResult {
    const baseOffset = attempt === 1 ? 820 : 2_480;

    timeline.push({
      id: `delivery-${attempt}`,
      offsetMs: baseOffset,
      kind: "webhook",
      tone: "neutral",
      title: `Webhook delivery · attempt ${attempt}`,
      detail: `${webhook.event} received with event ID ${webhook.eventId}`,
      data: { paymentId: webhook.paymentId, amount: webhook.amount }
    });

    if (this.mode === "protected" && this.processedEvents.has(webhook.eventId)) {
      timeline.push({
        id: `dedupe-${attempt}`,
        offsetMs: baseOffset + 110,
        kind: "database",
        tone: "success",
        title: "Duplicate event rejected atomically",
        detail: "The unique event claim already exists; no business side effect was repeated.",
        data: { eventId: webhook.eventId, rowsWritten: 0 }
      });

      return { statusCode: 200, timedOut: false, duplicateIgnored: true };
    }

    if (this.mode === "protected") {
      this.processedEvents.add(webhook.eventId);
    }

    const fulfilment: Fulfilment = {
      id: `ful_${String(this.fulfilments.length + 1).padStart(3, "0")}`,
      paymentId: webhook.paymentId,
      orderId: webhook.orderId,
      amount: webhook.amount,
      createdAt: new Date(Date.UTC(2026, 7, 23, 6, 30, 0, baseOffset)).toISOString()
    };
    this.fulfilments.push(fulfilment);

    timeline.push({
      id: `write-${attempt}`,
      offsetMs: baseOffset + 180,
      kind: "database",
      tone: attempt === 1 || this.mode === "protected" ? "success" : "danger",
      title: `Fulfilment ${fulfilment.id} committed`,
      detail:
        attempt === 1
          ? "The payment was converted into a fulfilment and shipment side effect."
          : "The same payment produced another fulfilment and shipment side effect.",
      data: { paymentId: webhook.paymentId, totalFulfilments: this.fulfilments.length }
    });

    if (attempt === 1) {
      timeline.push({
        id: "timeout-1",
        offsetMs: baseOffset + 390,
        kind: "network",
        tone: "warning",
        title: "Acknowledgement lost after commit",
        detail: "The merchant completed processing, but Razorpay observed a timeout instead of HTTP 200.",
        data: { observedStatus: 504, processingCompleted: true }
      });
      return { statusCode: 504, timedOut: true, duplicateIgnored: false };
    }

    return { statusCode: 200, timedOut: false, duplicateIgnored: false };
  }

  snapshot(): Fulfilment[] {
    return structuredClone(this.fulfilments);
  }
}
