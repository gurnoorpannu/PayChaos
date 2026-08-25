import { describe, expect, it } from "vitest";
import { runCampaign } from "./campaigns.js";
import {
  generateRegressionArtifact,
  regressionFixtureFromReport
} from "./regressionGenerator.js";
import { demoWebhookSecret, verifyRazorpayWebhook } from "./razorpay.js";

describe("regression generator", () => {
  it("preserves the exact signed payload, event ID, schedule, and invariant", () => {
    const report = runCampaign("concurrent-delivery-race", "vulnerable");
    const artifact = generateRegressionArtifact(report);
    const delivery = artifact.fixture.deliveries[0];

    expect(delivery.eventId).toBe("evt_Q8m4Race");
    expect(delivery.headers["x-razorpay-event-id"]).toBe(delivery.eventId);
    expect(JSON.parse(delivery.rawBody)).toMatchObject({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_Q8kwz3nE2s" } } }
    });
    expect(artifact.fixture.schedule.map((step) => step.offsetMs)).toEqual(
      report.timeline.map((step) => step.offsetMs)
    );
    expect(artifact.fixture.invariant).toMatchObject({
      id: "INV-004",
      vulnerableObserved: "2"
    });
    expect(artifact.source).toContain("runAdapter(\"vulnerable\")");
    expect(artifact.source).toContain("runAdapter(\"protected\")");
    expect(artifact.id).toBe(`reg_${artifact.checksum.slice(0, 12)}`);
  });

  it("preserves both events in an out-of-order incident", () => {
    const fixture = regressionFixtureFromReport(
      runCampaign("out-of-order-regression", "vulnerable")
    );

    expect(fixture.deliveries.map((delivery) => delivery.eventId)).toEqual([
      "evt_Q8m4Captured",
      "evt_Q8m4Failed"
    ]);
    expect(fixture.deliveries.map((delivery) => JSON.parse(delivery.rawBody).event)).toEqual([
      "payment.captured",
      "payment.failed"
    ]);
  });

  it("refuses to turn a passing report into a fake incident", () => {
    expect(() =>
      generateRegressionArtifact(runCampaign("crash-before-side-effect", "protected"))
    ).toThrow("requires a proven failed invariant");
  });

  it("preserves the stale signature over the tampered forged payload", () => {
    const fixture = regressionFixtureFromReport(
      runCampaign("forged-webhook", "vulnerable")
    );
    const delivery = fixture.deliveries[0];

    expect(JSON.parse(delivery.rawBody)).toMatchObject({
      payload: { payment: { entity: { amount: 50_001 } } }
    });
    expect(verifyRazorpayWebhook(
      delivery.rawBody,
      delivery.headers["x-razorpay-signature"],
      demoWebhookSecret
    )).toBe(false);
  });

  it("produces stable source and checksums for the same incident", () => {
    const first = generateRegressionArtifact(
      runCampaign("duplicate-after-timeout", "vulnerable")
    );
    const second = generateRegressionArtifact(
      runCampaign("duplicate-after-timeout", "vulnerable")
    );

    expect(first.source).toBe(second.source);
    expect(first.checksum).toBe(second.checksum);
    expect(first.fileName).toBe("paychaos.duplicate-after-timeout.regression.test.ts");
  });
});
