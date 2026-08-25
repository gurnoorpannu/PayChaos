# Intelligence providers

PayChaos uses intelligence to prioritize what should be tested. It never uses a
model response to decide whether a financial invariant passed or failed.

## Providers

### Grounded local analyzer

`grounded-rules-v1` is always available and requires no key. It maps scanner
risks to typed invariants, evidence, financial impact and executable scenario
IDs. This makes the demo deterministic and provides a baseline for model evals.

### OpenAI structured enrichment

When `OPENAI_API_KEY` is present, the dashboard offers an explicit **Send scan
metadata to OpenAI** action. It uses the Responses API:

- `POST /v1/responses`;
- model configured by `OPENAI_MODEL` (default `gpt-5.4`);
- `store: false`;
- strict JSON Schema through `text.format`;
- no built-in or custom tools;
- a 25-second request timeout;
- automatic local fallback on provider failure.

The current API contract follows the [official OpenAI Responses API
documentation](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

## Data boundary

Model input contains:

- file counts and language counts;
- detected provider names;
- relative file paths capped at 240 characters;
- webhook routes and events;
- boolean control signals;
- categorized side effects;
- static risk candidates and their evidence.

It excludes:

- raw source content;
- absolute repository roots;
- environment variables and credentials;
- application logs and database rows;
- dependency contents and generated output.

Scanning and enrichment are separate API actions. A scan is retained only in an
in-memory cache of at most 20 entries and referenced through an opaque scan ID.
Restarting the server clears the cache.

## Output contract

Both providers return the same shape:

```text
summary
invariants[]
  id, name, expression, rationale
hypotheses[]
  id, title, scenario, evidence[], confidence, financialImpact
```

Scenario values are constrained to known identifiers. Duplicate delivery,
concurrent delivery, out-of-order state, crash recovery, and forged-webhook
authenticity analysis all map directly to deterministic campaign operators.

## Failure behavior

Invalid JSON, schema drift, timeouts and non-2xx responses never become partial
AI results. PayChaos records a concise fallback reason and reruns analysis with
the grounded local provider. Campaign execution remains available.
