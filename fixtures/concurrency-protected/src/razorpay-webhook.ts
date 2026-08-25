router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers["x-razorpay-signature"]);
  if (req.body.event !== "payment.captured") return res.sendStatus(200);

  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: { eventId } // UNIQUE eventId
      });
      await tx.fulfilment.create({
        data: { paymentId: payment.id, orderId: payment.order_id }
      });
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
  }
  return res.sendStatus(200);
});
