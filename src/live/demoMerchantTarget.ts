import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { demoWebhookSecret, verifyRazorpayWebhook } from "../core/razorpay.js";
import type { Fulfilment, ProtectionMode } from "../core/types.js";

interface RazorpayEventBody {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
      };
    };
  };
}

export interface LiveRequestObservation {
  request: number;
  eventId: string;
  signatureValid: boolean;
  response: "pending" | "connection-closed" | "200" | "401";
  fulfilmentWrites: number;
  duplicateIgnored: boolean;
}

export interface LiveMerchantState {
  mode: ProtectionMode;
  fulfilments: Fulfilment[];
  processedEventIds: string[];
  requests: LiveRequestObservation[];
}

export interface LiveMerchantTarget {
  baseUrl: string;
  stop: () => Promise<void>;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function startDemoMerchantTarget(
  mode: ProtectionMode
): Promise<LiveMerchantTarget> {
  const app = express();
  const fulfilments: Fulfilment[] = [];
  const processedEventIds = new Set<string>();
  const requests: LiveRequestObservation[] = [];

  app.get("/__paychaos/health", (_request, response) => {
    response.json({ ok: true, target: "demo-merchant", mode });
  });

  app.get("/__paychaos/state", (_request, response) => {
    const state: LiveMerchantState = {
      mode,
      fulfilments: structuredClone(fulfilments),
      processedEventIds: [...processedEventIds],
      requests: structuredClone(requests)
    };
    response.json(state);
  });

  app.post(
    "/webhooks/razorpay",
    express.raw({ type: "application/json", limit: "256kb" }),
    (request, response) => {
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : "";
      const signature = request.get("x-razorpay-signature") ?? "";
      const eventId = request.get("x-razorpay-event-id") ?? "";
      const signatureValid = verifyRazorpayWebhook(
        rawBody,
        signature,
        demoWebhookSecret
      );
      const observation: LiveRequestObservation = {
        request: requests.length + 1,
        eventId,
        signatureValid,
        response: "pending",
        fulfilmentWrites: 0,
        duplicateIgnored: false
      };
      requests.push(observation);

      if (!signatureValid) {
        observation.response = "401";
        response.status(401).json({ error: "invalid signature" });
        return;
      }

      const body = JSON.parse(rawBody) as RazorpayEventBody;
      if (body.event !== "payment.captured") {
        observation.response = "200";
        response.sendStatus(200);
        return;
      }

      if (mode === "protected" && processedEventIds.has(eventId)) {
        observation.duplicateIgnored = true;
        observation.response = "200";
        response.status(200).json({ duplicateIgnored: true });
        return;
      }

      if (mode === "protected") processedEventIds.add(eventId);

      const payment = body.payload.payment.entity;
      fulfilments.push({
        id: `ful_live_${String(fulfilments.length + 1).padStart(3, "0")}`,
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount,
        createdAt: new Date(
          Date.UTC(2026, 7, 25, 7, 30, 0, 800 + fulfilments.length * 4)
        ).toISOString()
      });
      observation.fulfilmentWrites = 1;

      if (request.get("x-paychaos-fault") === "timeout-after-commit") {
        const delayedAcknowledgement = setTimeout(() => {
          observation.response = "200";
          response.status(200).json({ committed: true });
        }, 120);
        response.once("close", () => {
          clearTimeout(delayedAcknowledgement);
          if (!response.writableEnded) observation.response = "connection-closed";
        });
        return;
      }

      observation.response = "200";
      response.status(200).json({ committed: true });
    }
  );

  const server = createServer(app);
  await listen(server);
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      })
  };
}
