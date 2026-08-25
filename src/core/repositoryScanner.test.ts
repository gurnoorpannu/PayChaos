import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanRepository } from "./repositoryScanner.js";

const vulnerableFixture = fileURLToPath(
  new URL("../../fixtures/vulnerable-merchant", import.meta.url)
);
const protectedFixture = fileURLToPath(
  new URL("../../fixtures/protected-merchant", import.meta.url)
);
const crashVulnerableFixture = fileURLToPath(
  new URL("../../fixtures/crash-vulnerable", import.meta.url)
);
const crashProtectedFixture = fileURLToPath(
  new URL("../../fixtures/crash-protected", import.meta.url)
);
const concurrencyVulnerableFixture = fileURLToPath(
  new URL("../../fixtures/concurrency-vulnerable", import.meta.url)
);
const concurrencyProtectedFixture = fileURLToPath(
  new URL("../../fixtures/concurrency-protected", import.meta.url)
);

describe("repository scanner", () => {
  it("discovers application-specific risks in a vulnerable integration", async () => {
    const result = await scanRepository(vulnerableFixture);

    expect(result.filesScanned).toBe(1);
    expect(result.providers).toContain("Razorpay");
    expect(result.webhookSurfaces[0]).toMatchObject({
      route: "/webhooks/razorpay",
      signatureVerification: true,
      eventIdIdempotency: false,
      monotonicStateGuard: false
    });
    expect(result.risks.map((risk) => risk.id)).toEqual([
      "missing-event-idempotency",
      "non-monotonic-payment-state"
    ]);
  });

  it("recognizes the controls in a protected integration", async () => {
    const result = await scanRepository(protectedFixture);

    expect(result.webhookSurfaces[0]).toMatchObject({
      signatureVerification: true,
      eventIdIdempotency: true,
      transactionBoundary: true,
      monotonicStateGuard: true
    });
    expect(result.risks).toEqual([]);
    expect(result.staticScore).toBe(100);
  });

  it("respects explicit scan bounds", async () => {
    const result = await scanRepository(vulnerableFixture, { maxFiles: 0 });

    expect(result.filesScanned).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("detects the post-commit external side-effect gap", async () => {
    const vulnerable = await scanRepository(crashVulnerableFixture);
    const protectedResult = await scanRepository(crashProtectedFixture);

    expect(vulnerable.webhookSurfaces[0]).toMatchObject({
      eventIdIdempotency: true,
      transactionBoundary: true,
      durableOutbox: false
    });
    expect(vulnerable.risks).toContainEqual(
      expect.objectContaining({
        id: "non-atomic-external-side-effect",
        suggestedScenario: "crash-before-side-effect"
      })
    );
    expect(protectedResult.webhookSurfaces[0].durableOutbox).toBe(true);
    expect(protectedResult.risks).not.toContainEqual(
      expect.objectContaining({ id: "non-atomic-external-side-effect" })
    );
  });

  it("distinguishes a hopeful idempotency check from an atomic claim", async () => {
    const vulnerable = await scanRepository(concurrencyVulnerableFixture);
    const protectedResult = await scanRepository(concurrencyProtectedFixture);

    expect(vulnerable.webhookSurfaces[0]).toMatchObject({
      eventIdIdempotency: true,
      atomicEventClaim: false,
      transactionBoundary: false
    });
    expect(vulnerable.risks).toContainEqual(
      expect.objectContaining({
        id: "non-atomic-idempotency-check",
        suggestedScenario: "concurrent-delivery-race"
      })
    );
    expect(protectedResult.webhookSurfaces[0]).toMatchObject({
      eventIdIdempotency: true,
      atomicEventClaim: true,
      transactionBoundary: true
    });
    expect(protectedResult.risks).not.toContainEqual(
      expect.objectContaining({ id: "non-atomic-idempotency-check" })
    );
  });
});
