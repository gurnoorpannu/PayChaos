# Executable regressions

Every failed campaign can become a standalone Vitest artifact. The artifact is
evidence, not generated advice: it preserves the signed request bytes, event
ID, deterministic schedule, fault plan, and failed invariant from the proven
incident.

Choose **Download regression** on any failed finding. Save the downloaded file
at the repository root and run it with Vitest:

```bash
npx vitest run paychaos.<scenario>.regression.test.ts
```

The file executes two assertions:

1. the vulnerable adapter still reproduces the known incident;
2. the protected adapter passes the same schedule and invariant.

That two-sided contract prevents a false-green regression that silently stops
injecting the original failure. If the payload, event ID, schedule or oracle is
changed, review it as a new test rather than overwriting the incident fixture.

## Artifact contract

Each API response includes:

- a schema-versioned fixture;
- all signed deliveries in byte-preserving `rawBody` form;
- the virtual timeline and fault-plan operators;
- invariant ID, expression, expectation and vulnerable observation;
- complete TypeScript source;
- a SHA-256 checksum over that source.

The repository includes an actually executed example at
`regressions/paychaos.duplicate-after-timeout.regression.test.ts`. It crosses
the same live HTTP boundary as `CHAOS-001` in both vulnerable and protected
modes.
