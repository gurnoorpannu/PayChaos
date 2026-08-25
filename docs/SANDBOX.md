# Bounded Node target runner

PayChaos can execute a deliberately narrow JavaScript payment target without
running its package scripts, installing its dependencies, or granting it the
host process's capabilities. The dashboard accepts a selected `.js`/`.mjs`
entry or one of two bundled comparison targets.

## Target contract

The entry file must synchronously define two methods:

```js
globalThis.paychaosTarget = {
  handle({ rawBody, eventId, signatureValid }) {
    // Apply the payment event and return { statusCode: 200 }.
  },
  snapshot() {
    // Return JSON data containing { fulfilments: [...] }.
  }
};
```

Imports, package installation, async methods, arbitrary servers, environment
variables and database connections are outside this contract. The trusted
gateway verifies the Razorpay-shaped HMAC and passes its boolean result to the
target.

## Execution boundary

For each run, PayChaos:

1. validates relative paths, extensions, file counts and byte limits;
2. copies only selected source into a fresh `paychaos-run-*` directory;
3. starts a dedicated Node child with a 64 MB heap;
4. enables Node's permission model without child network access and grants
   read access only to the trusted worker and selected entry;
5. evaluates the target in a context without `process`, `require`, `fetch`,
   timers or dynamic string/Wasm code generation;
6. applies a 100 ms CPU timeout to initialization and each synchronous method;
7. exposes the target through a parent-owned ephemeral loopback HTTP gateway;
8. delivers the signed timeout-and-retry campaign and reads state over HTTP;
9. caps request bodies, captured output and the whole run at three seconds;
10. kills the child, closes the gateway and recursively removes the disposable
    directory in `finally`, including failed runs.

| Resource | Bound |
| --- | ---: |
| Selected files | 20 |
| Single source file | 100 KB |
| Total source | 500 KB |
| Request body | 64 KB |
| Operation CPU | 100 ms |
| Wall clock | 3 seconds |
| Child heap | 64 MB |
| Captured output | 16 KB |
| Child network | Denied |
| Child filesystem | Selected entry read-only |

Tests prove duplicate and protected behavior, traversal and size rejection,
host-global denial, CPU interruption, and workspace removal after success and
failure.

## Security scope

This runner is a buildathon-grade defensive boundary for the narrow target
contract, not a claim of hostile multi-tenant isolation. Node's `vm` context is
not treated as the sole boundary; it is layered inside a separate,
permission-restricted child. A production service should add an OS/container or
microVM boundary, a read-only root filesystem, cgroup quotas, seccomp, and an
egress proxy before accepting untrusted public repositories.
