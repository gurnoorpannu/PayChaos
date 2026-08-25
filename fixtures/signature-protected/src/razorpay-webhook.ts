router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  const signatureValid = verifyRazorpaySignature(
    req.rawBody,
    req.headers["x-razorpay-signature"]
  );
  if (!signatureValid) return res.sendStatus(401);
  const eventId = req.headers["x-razorpay-event-id"];

  await prisma.$transaction(async (tx) => {
    await tx.webhookEvent.create({
      data: { eventId } // eventId has a UNIQUE constraint
    });
    if (req.body.event === "payment.captured") {
      const payment = req.body.payload.payment.entity;
      await tx.fulfilment.create({
        data: { paymentId: payment.id, orderId: payment.order_id }
      });
    }
  });
  return res.sendStatus(200);
});
