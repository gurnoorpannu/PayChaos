router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers["x-razorpay-signature"]);
  if (req.body.event !== "payment.captured") return res.sendStatus(200);

  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;
  const alreadyProcessed = await prisma.webhookEvent.findFirst({
    where: { eventId }
  });
  if (alreadyProcessed) return res.sendStatus(200);

  await prisma.fulfilment.create({
    data: { paymentId: payment.id, orderId: payment.order_id }
  });
  await prisma.webhookEvent.create({ data: { eventId } });
  return res.sendStatus(200);
});
