router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  // Provider authenticity is never checked before the payment event is trusted.
  if (req.body.event === "payment.captured") {
    const payment = req.body.payload.payment.entity;
    await prisma.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
  }
  return res.sendStatus(200);
});
