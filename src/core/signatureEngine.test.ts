import { describe, expect, it } from "vitest";
import { runForgedWebhookCampaign } from "./signatureEngine.js";

describe("forged webhook campaign", () => {
  it("proves that an unchecked handler accepts a tampered capture", () => {
    const report = runForgedWebhookCampaign("vulnerable");

    expect(report.status).toBe("failed");
    expect(report.hypothesis.id).toBe("HYP-005");
    expect(report.invariants[0]).toMatchObject({
      id: "INV-005",
      observed: "1",
      passed: false
    });
    expect(report.fulfilments).toHaveLength(1);
    expect(report.evidenceTable.rows[0]).toMatchObject({
      signature: "invalid after tamper",
      response: "HTTP 200",
      writes: 1,
      _badge: "FORGED WRITE"
    });
  });

  it("proves that raw-body verification rejects the identical tamper", () => {
    const report = runForgedWebhookCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.invariants[0]).toMatchObject({ observed: "0", passed: true });
    expect(report.fulfilments).toHaveLength(0);
    expect(report.evidenceTable.rows[0]).toMatchObject({
      response: "HTTP 401",
      writes: 0,
      _badge: "REJECTED"
    });
  });

  it("uses byte tampering rather than an invented signature verdict", () => {
    const report = runForgedWebhookCampaign("vulnerable");
    const tamper = report.timeline.find((entry) => entry.id === "tampered");

    expect(tamper?.data).toMatchObject({
      forgedAmount: 50_001,
      signatureValid: false
    });
  });
});
