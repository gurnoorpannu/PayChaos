import { describe, expect, it, vi } from "vitest";
import {
  createRazorpayDiagnosticOrder,
  getRazorpayConnectorStatus,
  RazorpayConnectorError
} from "./razorpayTestMode.js";

const testEnvironment = {
  RAZORPAY_KEY_ID: "rzp_test_paychaos1234",
  RAZORPAY_KEY_SECRET: "super-secret-test-value"
};

describe("Razorpay Test Mode connector", () => {
  it("stays safely unconfigured when credentials are absent", () => {
    expect(getRazorpayConnectorStatus({})).toEqual({
      provider: "razorpay",
      mode: "unconfigured",
      configured: false,
      testMode: false,
      message: "Add Razorpay Test Mode credentials to enable diagnostic orders."
    });
  });

  it("rejects live credentials before making a network request", async () => {
    const request = vi.fn();

    await expect(
      createRazorpayDiagnosticOrder(
        {
          RAZORPAY_KEY_ID: "rzp_live_absolutelynot",
          RAZORPAY_KEY_SECRET: "still-secret"
        },
        request
      )
    ).rejects.toMatchObject({ code: "live_key_rejected" });

    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(getRazorpayConnectorStatus({
      RAZORPAY_KEY_ID: "rzp_live_absolutelynot",
      RAZORPAY_KEY_SECRET: "still-secret"
    }))).not.toContain("still-secret");
  });

  it("creates, fetches, and verifies one bounded test order", async () => {
    let receipt = "";
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        receipt = String(body.receipt);

        expect(url).toBe("https://api.razorpay.com/v1/orders");
        expect(body).toMatchObject({
          amount: 500,
          currency: "INR",
          partial_payment: false,
          notes: {
            purpose: "paychaos_diagnostic",
            environment: "test_only"
          }
        });
        expect(receipt).toMatch(/^paychaos_/);
        expect(receipt.length).toBeLessThanOrEqual(40);

        return new Response(JSON.stringify({
          id: "order_paychaos_test",
          amount: 500,
          currency: "INR",
          status: "created",
          receipt,
          created_at: 1_777_000_000
        }), {
          status: 200,
          headers: { "x-razorpay-request-id": "req_create" }
        });
      }

      expect(url).toBe("https://api.razorpay.com/v1/orders/order_paychaos_test");
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({
        id: "order_paychaos_test",
        amount: 500,
        currency: "INR",
        status: "created",
        receipt,
        created_at: 1_777_000_000
      }), {
        status: 200,
        headers: { "x-razorpay-request-id": "req_fetch" }
      });
    });

    const result = await createRazorpayDiagnosticOrder(testEnvironment, request);
    const expectedAuthorization = `Basic ${Buffer.from(
      `${testEnvironment.RAZORPAY_KEY_ID}:${testEnvironment.RAZORPAY_KEY_SECRET}`
    ).toString("base64")}`;

    expect(request).toHaveBeenCalledTimes(2);
    for (const [, init] of request.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(expectedAuthorization);
    }
    expect(result).toMatchObject({
      order: {
        id: "order_paychaos_test",
        amount: 500,
        currency: "INR",
        status: "created",
        receipt,
        source: "razorpay-test-mode"
      },
      roundTripVerified: true,
      createRequestId: "req_create",
      fetchRequestId: "req_fetch"
    });
    expect(JSON.stringify(result)).not.toContain(testEnvironment.RAZORPAY_KEY_SECRET);
    expect(JSON.stringify(result)).not.toContain(expectedAuthorization);
  });

  it("fails closed when the fetched order does not match", async () => {
    let receipt = "";
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        receipt = String((JSON.parse(String(init.body)) as { receipt: string }).receipt);
        return new Response(JSON.stringify({
          id: "order_created",
          amount: 500,
          currency: "INR",
          status: "created",
          receipt,
          created_at: 1_777_000_000
        }));
      }

      return new Response(JSON.stringify({
        id: "order_someone_else",
        amount: 500,
        currency: "INR",
        status: "created",
        receipt,
        created_at: 1_777_000_000
      }));
    });

    await expect(
      createRazorpayDiagnosticOrder(testEnvironment, request)
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not echo provider response bodies into connector errors", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ error: { description: testEnvironment.RAZORPAY_KEY_SECRET } }), {
        status: 401
      })
    );

    const error = await createRazorpayDiagnosticOrder(testEnvironment, request).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(RazorpayConnectorError);
    expect(JSON.stringify(error)).not.toContain(testEnvironment.RAZORPAY_KEY_SECRET);
    expect((error as Error).message).not.toContain(testEnvironment.RAZORPAY_KEY_SECRET);
  });
});
