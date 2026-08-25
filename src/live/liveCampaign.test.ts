import { describe, expect, it } from "vitest";
import { runLiveDuplicateCampaign } from "./liveCampaign.js";

describe("live HTTP duplicate-after-timeout campaign", () => {
  it("observes duplicate fulfilment through a running vulnerable target", async () => {
    const report = await runLiveDuplicateCampaign("vulnerable");

    expect(report.execution).toEqual({
      kind: "live-http",
      target: "ExpressDemoMerchant",
      transport: "HTTP",
      requests: 2,
      stateReads: 1
    });
    expect(report.status).toBe("failed");
    expect(report.fulfilments).toHaveLength(2);
    expect(report.invariants[0]).toMatchObject({ observed: "2", passed: false });
    expect(report.evidenceTable.rows[0]).toMatchObject({
      response: "client timeout",
      writes: 1,
      _badge: "ACK LOST"
    });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      writes: 1,
      _badge: "DUPLICATE"
    });
  });

  it("observes event deduplication through a running protected target", async () => {
    const report = await runLiveDuplicateCampaign("protected");

    expect(report.status).toBe("passed");
    expect(report.fulfilments).toHaveLength(1);
    expect(report.invariants[0]).toMatchObject({ observed: "1", passed: true });
    expect(report.evidenceTable.rows[1]).toMatchObject({
      writes: 0,
      _badge: "DEDUPED"
    });
  });
});
