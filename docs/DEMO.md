# Five-minute demo

## 0:00–0:30 — The problem

“This store works perfectly on the happy path. One Razorpay test payment creates
one fulfilment. But payment systems use asynchronous, at-least-once delivery,
so the happy path is not the production path.”

Show the **Vulnerable baseline** with a resilience score of 42.

## 0:30–1:15 — Understanding the integration

Scroll to **Discovered payment architecture**.

“PayChaos mapped the `payment.captured` route to an irreversible fulfilment
write. It found signature verification, but no event-level idempotency claim
around the side effect.”

Show the source evidence at `razorpay-webhook.ts:7`.

## 1:15–2:00 — The hypothesis

Show the fault plan:

```text
Deliver → Commit → Timeout → Retry
```

“AI chose this scenario because the write occurs before the acknowledgement.
It does not get to call this a vulnerability. The invariant oracle will decide
from the resulting database state.”

## 2:00–3:00 — The failure

Run the campaign and narrate the timeline:

1. The signed `payment.captured` webhook is accepted.
2. Fulfilment `ful_001` commits.
3. The acknowledgement is lost.
4. The same event ID is retried.
5. Fulfilment `ful_002` commits.
6. `INV-001` observes two fulfilments and fails.

Pause on:

> **One ₹500 payment created ₹1,000 of fulfilment obligation.**

## 3:00–4:10 — Diagnosis and control

Show **Critical finding**.

“The incident report connects the failure to the exact source line, explains
the post-commit timeout, quantifies the exposure, and recommends an atomic
claim on `x-razorpay-event-id`.”

Select **Verify fix**.

“The protected handler claims the event ID with a unique constraint inside the
same transaction as fulfilment.”

## 4:10–4:45 — Exact replay

The same signature, event ID, payload, and fault schedule run again. The retry
sees the existing event claim and writes zero rows. The score becomes 96 and
the invariant passes.

## 4:45–5:00 — Close

“A simulator tells you what events look like. A code reviewer tells you what
might be wrong. PayChaos connects both: it understands the integration,
constructs an application-specific failure, proves the impact, and replays the
same incident after the fix.”

> **AI can build a payment integration in minutes. PayChaos proves whether it
> can survive production.**

## Alternate campaign: out-of-order state

If time remains, select `CHAOS-002` and keep the vulnerable baseline enabled.
The campaign delivers a newer `payment.captured` snapshot and then releases an
older `payment.failed` event. The last-write-wins handler ends in `FAILED`.

Select **Verify fix** to replay the same two signed events against the monotonic
state guard. `CAPTURED` remains the final state and the stale failure is retained
as audit evidence without being applied.

## Alternate campaign: crash recovery

Select `CHAOS-003` to demonstrate a failure that ordinary idempotency does not
solve. The vulnerable handler commits its event claim and fulfilment, then the
merchant process exits with code 137 before `queueShipment` completes. After
restart, the identical event retry is correctly deduplicated—but the paid order
still has zero shipment jobs.

Pause on **Crash recovery checkpoints** and the `STRANDED` row. Then select
**Protected fix**. PayChaos replays the same crash window, but this handler wrote
a unique shipment intent to a transactional outbox beside the fulfilment. The
restarted worker dispatches it, the retry creates no duplicate, and `INV-003`
observes exactly one shipment job.

To connect repository understanding to execution, choose **Scan crash-gap demo**
in the Repository section. The grounded analyzer identifies the missing durable
handoff and its generated hypothesis launches `CHAOS-003` directly.
