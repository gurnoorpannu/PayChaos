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
