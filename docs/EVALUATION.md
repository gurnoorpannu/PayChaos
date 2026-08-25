# Scanner evaluation

PayChaos evaluates its architecture scanner against six bundled repositories
with explicit expected labels. Three contain one or more known payment
reliability defects; three contain the corresponding controls.

Run the reproducible evaluation:

```bash
npm run evaluate
npm run evaluate -- --json
```

## Bundled-v1 result

| Metric | Result |
| --- | ---: |
| Repository true positives | 3 |
| Repository true negatives | 3 |
| Repository false positives | 0 |
| Repository false negatives | 0 |
| Repository accuracy | 100% |
| Exact risk-label precision | 100% |
| Exact risk-label recall | 100% |
| Exact risk-label F1 | 100% |

| Fixture | Expected and observed result |
| --- | --- |
| `vulnerable-merchant` | missing event idempotency; non-monotonic payment state |
| `protected-merchant` | no supported risk pattern |
| `crash-vulnerable` | non-atomic external side effect |
| `crash-protected` | no supported risk pattern |
| `concurrency-vulnerable` | non-atomic idempotency check |
| `concurrency-protected` | no supported risk pattern |

The evaluation compares exact risk IDs, not only a vulnerable/safe binary. It
runs in CI so a scanner change that drops a known risk or invents one in a
protected fixture fails the build.

## Interpretation

This is a small, curated regression corpus. The 100% result proves that the
current rules distinguish the paired examples; it does not estimate precision
or recall on arbitrary production repositories. A production evaluation would
need blinded, independently labeled integrations across languages, frameworks,
ORMs, webhook styles, and payment lifecycles.
