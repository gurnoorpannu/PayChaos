import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanRepository } from "./repositoryScanner.js";

const vulnerableFixture = fileURLToPath(
  new URL("../../fixtures/vulnerable-merchant", import.meta.url)
);
const protectedFixture = fileURLToPath(
  new URL("../../fixtures/protected-merchant", import.meta.url)
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
});
