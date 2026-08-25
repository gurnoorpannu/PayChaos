import { describe, expect, it } from "vitest";
import { runCampaign } from "./campaigns.js";
import { runCrashRecoveryCampaign } from "./crashEngine.js";

describe("crash-before-side-effect campaign", () => {
  it("proves that a post-commit crash can strand a paid order", () => {
    const report = runCrashRecoveryCampaign("vulnerable");

    expect(report.status).toBe("failed");
    expect(report.fulfilments).toHaveLength(1);
    expect(report.invariants[0]).toMatchObject({
      expected: "1",
      observed: "0",
      passed: false
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      outbox: "missing",
      shipment: 0,
      _badge: "STRANDED"
    });
  });

  it("proves that a transactional outbox recovers after restart", () => {
    const report = runCrashRecoveryCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.fulfilments).toHaveLength(1);
    expect(report.invariants[0]).toMatchObject({
      expected: "1",
      observed: "1",
      passed: true
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      outbox: "dispatched",
      shipment: 1,
      _badge: "RECOVERED"
    });
  });

  it("dispatches crash recovery through the campaign registry", () => {
    const report = runCampaign("crash-before-side-effect", "vulnerable");

    expect(report.scenario).toBe("crash-before-side-effect");
    expect(report.hypothesis.id).toBe("HYP-003");
  });
});
