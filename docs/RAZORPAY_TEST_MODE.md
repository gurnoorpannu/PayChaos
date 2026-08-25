# Razorpay Test Mode connector

PayChaos can make one narrow, explicit provider request: create a ₹5 Razorpay
Test Mode order and fetch it back by ID. The round trip proves that the API
credentials, request contract and normalized response work without capturing a
payment or touching live money.

## Configure it

Create a local environment file and add credentials generated while the
Razorpay Dashboard is in Test Mode:

```bash
cp .env.example .env

RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

Restart the API, open the **Razorpay Test Mode connector** panel, and choose
**Create ₹5 test order**. PayChaos does not call Razorpay when the page loads.

## Safety contract

- Both credentials are read only by the server process.
- Any key that does not begin with `rzp_test_` is rejected before `fetch` runs.
- The client receives only a masked key hint; the secret is never serialized.
- The diagnostic amount is fixed at 500 paise (₹5) and currency at INR.
- The unique receipt is bounded to Razorpay's 40-character limit.
- The action creates an order and fetches it. It does not open Checkout,
  authorize, capture, refund, or transfer money.
- Provider error bodies are not echoed into API responses.
- When credentials are absent, every local scanner and chaos campaign remains
  available.

## API contract

`GET /api/razorpay/status` reports `test`, `unconfigured`, or `rejected`
without making a provider request.

`POST /api/razorpay/test-order` performs:

```text
POST /v1/orders → GET /v1/orders/:id → compare id, amount, currency, receipt
```

A successful response contains the normalized order, provider request IDs when
available, and `roundTripVerified: true`. A mismatch fails closed.

Razorpay references:

- [Test and Live Modes](https://razorpay.com/docs/payments/dashboard/test-live-modes/)
- [API authentication](https://razorpay.com/docs/api/authentication/)
- [Create an order](https://razorpay.com/docs/api/orders/create/)
- [Fetch an order by ID](https://razorpay.com/docs/api/orders/fetch-with-id/)
