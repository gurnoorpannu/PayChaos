import { describe, expect, it } from "vitest";
import { analyzeMerchant } from "./analyzer.js";
import { runDuplicateAfterTimeoutCampaign } from "./engine.js";

describe("duplicate-after-timeout campaign", () => {
  it("proves that the vulnerable handler duplicates fulfilment", () => {
    const report = runDuplicateAfterTimeoutCampaign("vulnerable");

    expect(report.status).toBe("failed");
    expect(report.fulfilments).toHaveLength(2);
    expect(report.invariants[0].passed).toBe(false);
    expect(report.finding.severity).toBe("critical");
  });

  it("proves that the protected handler absorbs the retry", () => {
    const report = runDuplicateAfterTimeoutCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.fulfilments).toHaveLength(1);
    expect(report.invariants[0].passed).toBe(true);
    expect(report.finding.severity).toBe("none");
  });
});

describe("architecture analyzer", () => {
  it("detects the missing idempotency boundary", () => {
    const analysis = analyzeMerchant("vulnerable");

    expect(analysis.webhookRoute).toBe("/webhooks/razorpay");
    expect(analysis.detectedEvent).toBe("payment.captured");
    expect(analysis.idempotencyGuard).toBe(false);
  });
});
