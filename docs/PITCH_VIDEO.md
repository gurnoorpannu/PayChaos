# Five-minute pitch video

This is the recording plan for the Razorpay AI Buildathon submission. Keep the
camera optional, the product full-screen, and the browser zoom at 100%. Record
one clean take under five minutes; do not speed up the product footage.

## Before recording

1. Open the [hosted demo](https://gurnoorpannu.github.io/PayChaos/) in a clean
   browser window and close unrelated tabs and notifications.
2. Keep the repository's Actions page ready in a second tab for the final proof.
3. Start on `CHAOS-001`, **Vulnerable baseline**, at the top of the dashboard.
4. Confirm the page says **HOSTED REPLAY**. Say that label aloud; the hosted
   build replays evidence generated during deployment, while a local clone runs
   the live HTTP target.
5. Rehearse the clicks once: run/scroll, verify fix, scan signature demo, launch
   its campaign, then show CI.

## Timed script and shot list

### 0:00–0:25 — Hook

**Screen:** PayChaos hero and campaign selector.

**Say:** “A payment integration can pass every happy-path test and still create
two orders for one payment when a webhook retries after a timeout. PayChaos is
an AI-powered payment reliability engineer. It does not test whether a payment
integration works. It tests whether it survives.”

### 0:25–0:55 — Product boundary

**Screen:** Scroll through the campaign operators and architecture summary.

**Say:** “PayChaos reads the payment architecture, identifies financial side
effects and controls, and generates an application-specific failure hypothesis.
Then AI steps out of the verdict. A deterministic engine injects the fault,
observes state, and evaluates a financial invariant. AI may suggest what to
attack; it cannot invent a failed test.”

### 0:55–1:35 — Understand and hypothesize

**Screen:** `CHAOS-001` architecture, hypothesis, and source evidence.

**Say:** “Here it mapped a Razorpay `payment.captured` webhook to a fulfilment
write. Signature verification exists, but there is no atomic claim on the
Razorpay event ID. Because the write happens before the acknowledgement,
PayChaos proposes: deliver, commit, lose the acknowledgement, and retry the
identical signed event. At this point it is still only a hypothesis.”

### 1:35–2:20 — Prove the failure

**Screen:** Timeline, invariant card, and fulfilment evidence table.

**Say:** “The first request commits one fulfilment. The client loses the HTTP
acknowledgement, so at-least-once delivery retries the byte-identical payload
and event ID. The vulnerable handler commits again. The oracle observes two
rows where the invariant permits at most one. One ₹500 payment has now created
₹1,000 of fulfilment obligation. The report connects what broke, why, the exact
source boundary, financial impact, and reproduction schedule.”

### 2:20–2:55 — Fix, replay, preserve

**Screen:** Click **Verify fix**, then point to **Download regression**.

**Say:** “The protected handler claims the event ID with a unique constraint in
the same transaction as the fulfilment. PayChaos replays the same payload,
signature, timeout, and retry. The second delivery becomes a no-op and the
invariant passes. The exact incident can also be exported as a checksummed
Vitest regression, so the failure stays fixed.”

### 2:55–3:30 — Show depth

**Screen:** Cycle through `CHAOS-002`, `CHAOS-003`, and `CHAOS-004` without
waiting on every panel.

**Say:** “This is not a duplicate-webhook demo wrapped in AI. PayChaos also
releases stale events out of order, crashes after the database commit but
before shipment, and synchronizes two workers inside a non-atomic idempotency
check. The fixes are architecture-specific: monotonic state transitions,
transactional outbox recovery, and an atomic unique event claim.”

### 3:30–4:10 — Scanner to forged-webhook attack

**Screen:** In Repository, click **Scan signature demo**, show its evidence,
then click **Run deterministic campaign** for `CHAOS-005`.

**Say:** “The repository scanner also closes the loop. This fixture handles
Razorpay captures but never authenticates the raw request body. PayChaos turns
that evidence into a forged-webhook hypothesis. It signs a valid capture,
changes the amount by one paise, and delivers the forged bytes with the stale
signature. The vulnerable route creates value; the protected route returns 401
before any business write.”

### 4:10–4:38 — Real and bounded boundaries

**Screen:** Bounded runner and Razorpay Test Mode panels.

**Say:** “Locally, the primary campaign crosses real loopback HTTP. Selected
JavaScript can run in a disposable permission-restricted child with denied
network, strict resource limits, and verified cleanup. An optional Razorpay
Test Mode connector creates and fetches one fixed ₹5 order; live keys are
rejected before network access.”

### 4:38–5:00 — Evidence and close

**Screen:** GitHub Actions, then return to the score and tagline.

**Say:** “The build has 46 deterministic tests and an eight-repository labeled
scanner corpus with exact-label checks in CI. That corpus is intentionally
small and curated, so I do not claim production precision from it. PayChaos is
built for the Open Track: meaningful AI for a real payment problem, with every
financial verdict backed by deterministic evidence. AI can build a payment
integration in minutes. PayChaos proves whether it can survive production.”

## Claims to keep precise

- Say **AI-powered hypothesis generation**, not “AI proves failures.”
- Say **Razorpay-shaped signed events** for local campaigns; only the optional
  connector calls Razorpay Test Mode.
- Say **live loopback HTTP** for `CHAOS-001`; the other four campaigns are
  deterministic in-process models.
- Say **small curated evaluation corpus** beside the 100% bundled result.
- Say **bounded selected-JavaScript runner**, not production multi-tenant
  sandbox.

## Submission assets

- Public repository: <https://github.com/gurnoorpannu/PayChaos>
- Hosted demo: <https://gurnoorpannu.github.io/PayChaos/>
- Architecture and trust boundaries: [ARCHITECTURE.md](ARCHITECTURE.md)
- Reproducible scanner metrics: [EVALUATION.md](EVALUATION.md)
- Buildathon brief: [SUBMISSION.md](SUBMISSION.md)
- Final video URL: add after upload
