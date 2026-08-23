import { describe, expect, it } from "vitest";
import {
  createSignedWebhookRequest,
  demoWebhookSecret,
  verifyRazorpayWebhook
} from "./razorpay.js";
import type { PaymentWebhook } from "./types.js";

const webhook: PaymentWebhook = {
  eventId: "evt_test_001",
  event: "payment.captured",
  paymentId: "pay_test_001",
  orderId: "order_test_001",
  amount: 50_000,
  currency: "INR"
};

describe("Razorpay webhook signatures", () => {
  it("accepts the exact raw request body", () => {
    const request = createSignedWebhookRequest(webhook);

    expect(
      verifyRazorpayWebhook(
        request.rawBody,
        request.headers["x-razorpay-signature"],
        demoWebhookSecret
      )
    ).toBe(true);
  });

  it("rejects a payload changed after signing", () => {
    const request = createSignedWebhookRequest(webhook);
    const tamperedBody = request.rawBody.replace("50000", "500000");

    expect(
      verifyRazorpayWebhook(
        tamperedBody,
        request.headers["x-razorpay-signature"],
        demoWebhookSecret
      )
    ).toBe(false);
  });
});
