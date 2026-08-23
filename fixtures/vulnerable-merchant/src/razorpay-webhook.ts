router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers["x-razorpay-signature"]);
  const payment = req.body.payload.payment.entity;

  if (req.body.event === "payment.captured") {
    await prisma.fulfilment.create({
      data: { paymentId: payment.id, orderId: payment.order_id }
    });
    await queueShipment(payment.order_id);
  }

  if (req.body.event === "payment.failed") {
    await prisma.payment.update({
      where: { razorpayPaymentId: payment.id },
      data: { status: "FAILED" }
    });
  }

  return res.sendStatus(200);
});
