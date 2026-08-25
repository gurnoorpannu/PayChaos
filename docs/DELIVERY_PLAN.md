# Delivery plan

PayChaos is being completed in five independently shippable phases. A phase
does not begin until the previous phase is implemented, verified, committed,
and pushed.

| Phase | Outcome | Status |
| --- | --- | --- |
| 1. Live execution | Attack a running HTTP merchant and evaluate observed state | Complete |
| 2. Razorpay Test Mode | Verify real test orders, payments and connector health | Pending |
| 3. Regression generation | Emit and execute a test from a proven incident | Pending |
| 4. Repository sandbox | Run a selected Node target with bounded capabilities | Pending |
| 5. Submission hardening | Evaluation corpus, hosted demo and final walkthrough | Pending |

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

Planned exit criteria:

- validate credential presence without exposing key material;
- fetch or create a bounded test-mode order through the official API;
- normalize the Razorpay response into campaign fixtures;
- expose connector status and a safe diagnostic action;
- retain the fully local fallback when credentials are absent.

## Phase 3 — Regression generation

Planned exit criteria:

- convert a proven incident into a standalone Vitest artifact;
- preserve payload, event ID, schedule and invariant;
- execute the generated test against vulnerable and protected adapters;
- download the artifact from the dashboard.

## Phase 4 — Repository sandbox

Planned exit criteria:

- support a narrowly defined Node target contract;
- copy selected sources into a disposable directory;
- apply CPU, time, file and network bounds;
- start the target and collect HTTP plus state evidence;
- always tear down the target and temporary workspace.

## Phase 5 — Submission hardening

Planned exit criteria:

- evaluate scanner precision across the bundled vulnerability corpus;
- publish a hosted read-only demonstration;
- add a submission checklist and three-to-five-minute walkthrough;
- verify clean installation, CI, responsive layout and failure behavior.
