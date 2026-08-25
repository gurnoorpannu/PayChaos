globalThis.paychaosTarget = (() => {
  const fulfilments = [];
  const claimedEvents = new Set();

  return {
    handle(request) {
      if (!request.signatureValid) return { statusCode: 401 };
      if (claimedEvents.has(request.eventId)) return { statusCode: 200 };
      claimedEvents.add(request.eventId);
      const event = JSON.parse(request.rawBody);
      const payment = event.payload.payment.entity;
      fulfilments.push({
        id: `ful_sandbox_${fulfilments.length + 1}`,
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount
      });
      return { statusCode: 200 };
    },
    snapshot() {
      return { fulfilments: fulfilments.map((item) => ({ ...item })) };
    }
  };
})();
