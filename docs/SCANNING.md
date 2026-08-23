# Repository scanning

The local scanner is the first stage of codebase ingestion. It extracts payment
architecture signals from source code without installing dependencies or
executing the target repository.

## Usage

```bash
npm run scan -- /path/to/repository
npm run scan -- /path/to/repository --json
```

Example:

```text
PayChaos repository scan
Files         1
Providers     Razorpay
Webhook paths 1
Static score  54/100

src/razorpay-webhook.ts:1  /webhooks/razorpay
  events       payment.captured, payment.failed
  side effects create fulfilment, update payment state, queue shipment
  controls     signature=true event-id=false transaction=false monotonic=false

2 hypothesis candidates
  [CRITICAL] Captured payment can repeat an irreversible side effect
  [HIGH] Delivery order can overwrite payment truth
```

The score is static prioritization, not a shipment verdict. A risk becomes a
proven finding only after its suggested deterministic campaign violates an
invariant.

## Signals

The scanner currently extracts:

- Razorpay provider usage;
- webhook routes and payment, order or refund events;
- raw-body signature verification;
- `x-razorpay-event-id` deduplication claims;
- transaction boundaries;
- monotonic captured-state guards;
- fulfilment, order, payment-state, shipment and notification side effects.

Those signals generate bounded candidates for:

- forged-webhook testing;
- duplicate delivery after a post-commit timeout;
- out-of-order payment-state regression.

## Bounds and exclusions

Default limits:

| Control | Limit |
| --- | ---: |
| Source files | 500 |
| Total bytes | 2 MB |
| Individual file | 150 KB |

Supported extensions are `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`,
`.java`, `.go`, `.rb`, `.php`, and `.cs`.

The walk skips symlinks, `.git`, dependencies, coverage, build output, vendor
directories, and common framework output. Reaching any bound marks the scan as
truncated instead of silently pretending the repository was fully inspected.

## Trust boundary

The scanner performs reads only. It does not:

- run package scripts;
- install target dependencies;
- start the target application;
- invoke the target test suite;
- follow symbolic links;
- transmit source code to a model or remote service.

Future sandbox execution must remain a separate, explicit stage with isolated
credentials, network policy and disposable backing services.
