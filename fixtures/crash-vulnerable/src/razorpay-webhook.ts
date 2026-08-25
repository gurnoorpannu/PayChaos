router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers["x-razorpay-signature"]);
  const eventId = req.headers["x-razorpay-event-id"];
  if (req.body.event !== "payment.captured") return res.sendStatus(200);
  const payment = req.body.payload.payment.entity;

  const claimed = await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.create({
      data: { eventId } // UNIQUE eventId
    }).catch(() => null);
    if (!event) return false;
    await tx.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
    return true;
  });

  if (!claimed) return res.sendStatus(200);
  await queueShipment(payment.order_id);
  return res.sendStatus(200);
});
