import { describe, expect, it } from "vitest";
import { runCampaign } from "./campaigns.js";
import { runOutOfOrderCampaign } from "./stateEngine.js";

describe("out-of-order state campaign", () => {
  it("proves that last-write-wins regresses a captured payment", () => {
    const report = runOutOfOrderCampaign("vulnerable");

    expect(report.status).toBe("failed");
    expect(report.invariants[0]).toMatchObject({
      expected: "CAPTURED",
      observed: "FAILED",
      passed: false
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      event: "payment.failed",
      previous: "CAPTURED",
      next: "FAILED",
      outcome: "applied"
    });
  });

  it("proves that a monotonic guard blocks the stale failure", () => {
    const report = runOutOfOrderCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.invariants[0]).toMatchObject({
      expected: "CAPTURED",
      observed: "CAPTURED",
      passed: true
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      event: "payment.failed",
      previous: "CAPTURED",
      next: "CAPTURED",
      outcome: "ignored"
    });
  });

  it("dispatches the scenario through the campaign registry", () => {
    const report = runCampaign("out-of-order-regression", "vulnerable");

    expect(report.scenario).toBe("out-of-order-regression");
    expect(report.hypothesis.id).toBe("HYP-002");
  });
});
