# Delivery plan

PayChaos is being completed in five independently shippable phases. A phase
does not begin until the previous phase is implemented, verified, committed,
and pushed.

| Phase | Outcome | Status |
| --- | --- | --- |
| 1. Live execution | Attack a running HTTP merchant and evaluate observed state | Complete |
| 2. Razorpay Test Mode | Verify a real test order and connector health | Complete |
| 3. Regression generation | Emit and execute a test from a proven incident | Complete |
| 4. Repository sandbox | Run a selected Node target with bounded capabilities | Complete |
| 5. Submission hardening | Evaluation corpus, hosted demo and final walkthrough | Complete |

## Phase 1 — Live execution

`CHAOS-001` now crosses a real process-style boundary through an ephemeral HTTP
server:

1. Start an isolated Express merchant on a loopback port selected by the OS.
2. Deliver a signed Razorpay-shaped `payment.captured` request over HTTP.
3. Commit fulfilment inside the running target.
4. Abort the client acknowledgement after commit.
5. Retry the byte-identical payload and event ID.
6. Read the target's instrumented state endpoint.
7. Evaluate `INV-001` from those observed rows.
8. Close every target connection and release the port.

The vulnerable route produces two observed fulfilments. The protected route
uses its unique event claim to reduce the second request to a no-op. Both modes
are covered by integration tests that use actual loopback HTTP transport.

The remaining campaigns still use deterministic in-process models. Their
execution metadata labels this distinction explicitly in API responses and the
dashboard.

## Phase 2 — Razorpay Test Mode

The provider boundary is intentionally smaller than the chaos engine:

1. Read credentials only inside the server process.
2. Reject every key that does not start with `rzp_test_` before a request runs.
3. Create a fixed ₹5 INR order only after an explicit dashboard action.
4. Fetch that order from Razorpay by ID.
5. Compare ID, amount, currency and receipt before returning verified evidence.
6. Normalize the response without serializing credentials or authorization.

The status route performs no provider call. Missing credentials retain the
complete local demo, while provider error bodies are not echoed into responses.
Mock contract tests cover authentication, the create/fetch sequence, bounded
receipt metadata, live-key rejection, mismatch handling and secret redaction.
See [RAZORPAY_TEST_MODE.md](RAZORPAY_TEST_MODE.md).

## Phase 3 — Regression generation

Every failed campaign exposes a **Download regression** action. PayChaos reruns
the vulnerable adapter to ground the artifact, then emits standalone Vitest
source with a SHA-256 checksum. The schema-versioned fixture retains every
signed raw payload and event ID, the exact fault plan and virtual schedule, and
the deterministic invariant plus vulnerable observation.

The generated test requires both behaviors: the vulnerable adapter must still
reproduce the incident and the protected adapter must pass the identical replay.
The repository's checked-in `CHAOS-001` artifact is included in the normal test
suite and executes both paths through live loopback HTTP. See
[REGRESSIONS.md](REGRESSIONS.md).

## Phase 4 — Repository sandbox

The dashboard can run a bundled or browser-selected JavaScript target through a
narrow synchronous `handle()`/`snapshot()` contract. Selected sources are
validated and copied into a disposable directory. A separate Node child gets a
64 MB heap, permission-model filesystem restrictions, no child network access,
a capability-minimal VM context, 100 ms per-operation CPU limits, bounded input
and output, and a three-second wall deadline.

A trusted parent-owned loopback gateway delivers two real signed HTTP requests
and performs a state read. Result evidence distinguishes target behavior from
containment metadata. Cleanup kills the child, closes the server and removes the
temporary workspace in `finally`; success and adversarial failure paths are
covered by tests. See [SANDBOX.md](SANDBOX.md) for the contract and production
isolation caveat.

## Phase 5 — Submission hardening

The scanner now has an exact-label evaluation over eight labeled repositories
and CI fails on a missed or invented bundled risk. The current corpus reports
four true-positive repositories, four true negatives, zero false results, and 100%
exact-label precision/recall with an explicit small-curated-corpus caveat.

Submission hardening also closes the fifth end-to-end loop: a missing signature
boundary detected during scanning can launch `CHAOS-005`, which tampers with a
previously signed raw request and verifies that an invalid signature produces
zero business writes. The project is positioned honestly in Track 05 — Open
Track, with a timed recording plan in [PITCH_VIDEO.md](PITCH_VIDEO.md).

GitHub Pages publishes an HTTPS read-only demo generated from the same live
campaign, repository and bounded-runner implementations. The UI labels replayed
evidence and disables actions requiring a local trusted process. The final
browser pass covered desktop interactions, the public URL, console errors,
disabled live-only controls, and a 390 px viewport without horizontal overflow.

CI uses a clean Node 22 `npm ci`, runs the full suite, evaluates the scanner and
builds production assets. The separate Pages workflow regenerates verified
evidence before deploying. See [EVALUATION.md](EVALUATION.md) and the judge-ready
[SUBMISSION.md](SUBMISSION.md).
