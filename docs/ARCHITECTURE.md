# Architecture

PayChaos separates probabilistic reasoning from financial truth. This is the
central design constraint, not an implementation detail.

## Components

### 1. Architecture analyzer

The analyzer converts payment code into a compact architecture model:

- webhook entrypoint and subscribed event;
- signature-verification boundary;
- database writes and irreversible business side effects;
- transaction boundaries;
- idempotency keys and uniqueness constraints;
- payment-state transitions.

The local MVP includes a bounded repository scanner that maps TypeScript,
JavaScript, Python, Java, Go, Ruby, PHP and C# source files without executing
them. It detects Razorpay webhook surfaces and control boundaries before
producing hypothesis candidates. An optional schema-constrained model provider
can enrich the same typed structure without changing the campaign engine, while
the deterministic local provider keeps development and evaluation key-free.

### 2. Hypothesis generator

Hypotheses are grounded in detected evidence. For example:

```text
Evidence:
  payment.captured → fulfilment.create → HTTP 200
  no x-razorpay-event-id claim detected

Hypothesis:
  if the database commits but the acknowledgement is lost,
  retrying the event can repeat fulfilment.
```

A hypothesis contains a fault plan and the invariant that will determine its
outcome. It is not itself a finding.

### 3. Deterministic chaos scheduler

The scheduler owns event payloads, delivery order, duplicated IDs, virtual
timestamps, injected failures, and replay. The same campaign definition must
produce the same observable sequence.

`CHAOS-001` currently runs:

```text
t+0.76  verify HMAC signature
t+0.82  deliver payment.captured
t+1.00  commit fulfilment
t+1.21  lose acknowledgement after commit
t+1.72  schedule at-least-once retry
t+2.42  verify the same HMAC signature
t+2.48  redeliver the same event ID
t+3.24  evaluate financial invariant
```

`CHAOS-002` currently runs:

```text
t+0.70  verify and deliver a newer payment.captured snapshot
t+0.92  persist CAPTURED
t+1.58  release a payment.failed event created 60 seconds earlier
t+1.72  verify the authentic but stale failure
t+1.94  apply or block the requested state regression
t+2.26  evaluate the monotonic-state invariant
```

### 4. Merchant adapter

The adapter is the narrow interface between a campaign and the system under
test. In the local MVP it is an in-memory merchant with vulnerable and
protected modes. A sandbox adapter will later translate the same operations to
HTTP, process, database, and telemetry controls around a real application.

### 5. Invariant oracle

The oracle evaluates observed state, never generated prose.

Current invariant:

```text
INV-001 exactly-once fulfilment
count(fulfilments where payment_id = P) <= 1

INV-002 captured state is monotonic
captured(P) implies final_status(P) = CAPTURED
```

Future invariants will cover amount conservation, capture and refund bounds,
order-to-payment cardinality, and once-only external side effects.

### 6. Incident reconstruction

The report joins the architecture evidence, hypothesis, execution timeline,
database outcome, failed invariant, financial exposure, reproduction steps,
and recommended control. Explanations are downstream of proof.

## Trust boundaries

```mermaid
flowchart TB
    subgraph Probabilistic[Probabilistic plane]
      A[Repository understanding]
      B[Invariant suggestions]
      C[Failure hypotheses]
      D[Incident explanation]
    end

    subgraph Deterministic[Deterministic plane]
      E[Signed event fixtures]
      F[Fault scheduler]
      G[Observed system state]
      H[Invariant evaluation]
    end

    A --> B --> C --> F
    E --> F --> G --> H
    H --> D
    A --> D
```

The probabilistic plane may prioritize or explain. The deterministic plane
alone decides pass or fail.

## Intelligence provider boundary

Repository analysis is a two-step, consent-preserving flow:

1. Source files are scanned locally and assigned a short-lived scan ID.
2. Only an explicit enrichment request can send bounded scan metadata to the
   configured model provider.

Raw source, absolute repository roots and credentials are excluded from the
model input. The Responses API request uses strict JSON Schema output and
`store: false`. Provider failure falls back to grounded local rules instead of
blocking deterministic campaigns.

## Moving from the MVP to repository execution

The intended runner lifecycle is:

1. Clone a user-authorized repository at an immutable commit.
2. Detect its runtime, payment surface, and test command without executing code.
3. Present the inferred execution plan and required capabilities.
4. Build inside a disposable sandbox with no production credentials.
5. Start the application and disposable backing services.
6. Execute signed test-mode campaigns through a narrow network proxy.
7. collect structured logs, traces, database diffs, and outbound side effects.
8. Destroy the sandbox and retain only redacted evidence.

Repository code and logs are untrusted input. Generated commands must never be
executed directly outside the sandbox boundary.

The current scanner is intentionally read-only. It skips symlinks, dependency
trees, generated output, oversized files, and repositories beyond explicit file
and byte limits. See [SCANNING.md](SCANNING.md).
