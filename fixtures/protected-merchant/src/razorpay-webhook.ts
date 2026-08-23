router.post("/webhooks/razorpay", rawBody, async (req, res) => {
  verifyRazorpaySignature(req.body, req.headers["x-razorpay-signature"]);
  const eventId = req.headers["x-razorpay-event-id"];
  const payment = req.body.payload.payment.entity;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.webhookEvent.create({
      data: { eventId } // UNIQUE eventId rejects duplicates
    }).catch(() => null);
    if (!claimed) return;

    const current = await tx.payment.findUnique({
      where: { razorpayPaymentId: payment.id }
    });

    // CAPTURED is monotonic; ignore payment.failed after capture.
    if (current.status === "CAPTURED" && req.body.event === "payment.failed") return;

    if (req.body.event === "payment.captured") {
      await tx.fulfilment.create({
        data: { paymentId: payment.id, orderId: payment.order_id }
      });
    }

    await tx.payment.update({
      where: { razorpayPaymentId: payment.id },
      data: { status: req.body.event === "payment.captured" ? "CAPTURED" : "FAILED" }
    });
  });

  return res.sendStatus(200);
});
