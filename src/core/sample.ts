export const vulnerableMerchantSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);

  if (req.body.event === "payment.captured") {
    const payment = req.body.payload.payment.entity;

    await prisma.fulfilment.create({
      data: {
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount
      }
    });

    await queueShipment(payment.order_id);
  }

  return res.sendStatus(200);
});`;

export const protectedMerchantSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const eventId = req.headers["x-razorpay-event-id"];

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.webhookEvent.create({
      data: { eventId }, // eventId has a UNIQUE constraint
    }).catch(() => null);

    if (!claimed) return;

    if (req.body.event === "payment.captured") {
      const payment = req.body.payload.payment.entity;
      await tx.fulfilment.create({
        data: { paymentId: payment.id, orderId: payment.order_id }
      });
    }
  });

  return res.sendStatus(200);
});`;

export const vulnerableStateSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const payment = req.body.payload.payment.entity;

  if (req.body.event === "payment.captured") {
    await prisma.payment.update({
      where: { razorpayPaymentId: payment.id },
      data: { status: "CAPTURED" }
    });
  }

  if (req.body.event === "payment.failed") {
    await prisma.payment.update({
      where: { razorpayPaymentId: payment.id },
      data: { status: "FAILED" }
    });
  }

  return res.sendStatus(200);
});`;

export const protectedStateSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const payment = req.body.payload.payment.entity;
  const current = await prisma.payment.findUnique({
    where: { razorpayPaymentId: payment.id }
  });

  // CAPTURED is monotonic: an older failure cannot regress confirmed funds.
  if (current.status === "CAPTURED" && req.body.event === "payment.failed") {
    return res.sendStatus(200);
  }

  await prisma.payment.update({
    where: { razorpayPaymentId: payment.id },
    data: {
      status: req.body.event === "payment.captured" ? "CAPTURED" : "FAILED"
    }
  });

  return res.sendStatus(200);
});`;

export const vulnerableCrashSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;

  const claimed = await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.create({
      data: { eventId } // eventId has a UNIQUE constraint
    }).catch(() => null);
    if (!event) return false;

    await tx.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
    return true;
  });

  if (!claimed) return res.sendStatus(200);

  // A crash here loses the shipment forever; retry sees an already-claimed event.
  await queueShipment(payment.order_id);
  return res.sendStatus(200);
});`;

export const protectedCrashSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;

  await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.create({
      data: { eventId } // eventId has a UNIQUE constraint
    }).catch(() => null);
    if (!event) return;

    await tx.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
    await tx.outbox.create({
      data: {
        key: "shipment:" + payment.order_id, // UNIQUE outbox key
        topic: "shipment.requested",
        payload: { orderId: payment.order_id }
      }
    });
  });

  return res.sendStatus(200);
});

// A restart-safe worker drains pending outbox rows until dispatch succeeds.
await outboxWorker.start({ retry: "exponential", delivery: "at-least-once" });`;

export const vulnerableConcurrencySource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;

  // Looks idempotent, but two workers can both observe "not processed".
  const alreadyProcessed = await prisma.webhookEvent.findFirst({
    where: { eventId }
  });
  if (alreadyProcessed) return res.sendStatus(200);

  await prisma.fulfilment.create({
    data: { paymentId: payment.id, orderId: payment.order_id }
  });
  await prisma.webhookEvent.create({ data: { eventId } });
  return res.sendStatus(200);
});`;

export const protectedConcurrencySource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers);
  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: { eventId } // eventId has a UNIQUE constraint
      });
      await tx.fulfilment.create({
        data: { paymentId: payment.id, orderId: payment.order_id }
      });
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    // Another worker atomically claimed this event.
  }
  return res.sendStatus(200);
});`;

export const vulnerableSignatureSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  // The payload is trusted without verifying x-razorpay-signature.
  if (req.body.event === "payment.captured") {
    const payment = req.body.payload.payment.entity;
    await prisma.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
  }
  return res.sendStatus(200);
});`;

export const protectedSignatureSource = `router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  const signatureValid = verifyRazorpaySignature(
    req.rawBody,
    req.headers["x-razorpay-signature"]
  );
  if (!signatureValid) return res.sendStatus(401);

  if (req.body.event === "payment.captured") {
    const payment = req.body.payload.payment.entity;
    await prisma.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
  }
  return res.sendStatus(200);
});`;
