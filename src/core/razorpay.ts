import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentWebhook, SignedWebhookRequest } from "./types.js";

export const demoWebhookSecret = "paychaos_demo_webhook_secret_32_chars";

export function createRazorpayPayload(webhook: PaymentWebhook): string {
  const status = webhook.event === "payment.captured" ? "captured" : "failed";
  return JSON.stringify({
    entity: "event",
    account_id: "acc_paychaos_demo",
    event: webhook.event,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: webhook.paymentId,
          entity: "payment",
          amount: webhook.amount,
          currency: webhook.currency,
          status,
          order_id: webhook.orderId
        }
      }
    },
    created_at: webhook.createdAt ?? 1_776_925_800
  });
}

export function signRazorpayWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyRazorpayWebhook(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = Buffer.from(signRazorpayWebhook(rawBody, secret), "utf8");
  const provided = Buffer.from(signature, "utf8");

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function createSignedWebhookRequest(
  webhook: PaymentWebhook,
  secret = demoWebhookSecret
): SignedWebhookRequest {
  const rawBody = createRazorpayPayload(webhook);
  return {
    webhook,
    rawBody,
    headers: {
      "x-razorpay-event-id": webhook.eventId,
      "x-razorpay-signature": signRazorpayWebhook(rawBody, secret)
    }
  };
}
