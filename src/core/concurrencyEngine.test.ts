import { describe, expect, it } from "vitest";
import { runCampaign } from "./campaigns.js";
import { runConcurrentDeliveryCampaign } from "./concurrencyEngine.js";

describe("concurrent-delivery-race campaign", () => {
  it("reproduces a check-then-insert race deterministically", () => {
    const report = runConcurrentDeliveryCampaign("vulnerable");

    expect(report.status).toBe("failed");
    expect(report.fulfilments).toHaveLength(2);
    expect(report.invariants[0]).toMatchObject({
      expected: "≤ 1",
      observed: "2",
      passed: false
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      claim: "committed",
      outcome: "fulfilment created",
      _badge: "DUPLICATE"
    });
  });

  it("serializes workers with an atomic unique event claim", () => {
    const report = runConcurrentDeliveryCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.fulfilments).toHaveLength(1);
    expect(report.invariants[0]).toMatchObject({ observed: "1", passed: true });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      claim: "unique conflict",
      outcome: "safe no-op",
      _badge: "BLOCKED"
    });
  });

  it("dispatches concurrency through the campaign registry", () => {
    const report = runCampaign("concurrent-delivery-race", "vulnerable");

    expect(report.scenario).toBe("concurrent-delivery-race");
    expect(report.hypothesis.id).toBe("HYP-004");
  });
});
