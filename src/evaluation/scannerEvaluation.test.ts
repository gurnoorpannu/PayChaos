import { describe, expect, it } from "vitest";
import { runScannerEvaluation } from "./scannerEvaluation.js";

describe("scanner evaluation corpus", () => {
  it("classifies every bundled vulnerable and protected repository", async () => {
    const evaluation = await runScannerEvaluation();

    expect(evaluation.repositories).toBe(8);
    expect(evaluation.repositoryClassification).toEqual({
      truePositive: 4,
      trueNegative: 4,
      falsePositive: 0,
      falseNegative: 0,
      accuracy: 1
    });
    expect(evaluation.riskLabels).toEqual({
      truePositive: 6,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      f1: 1
    });
    expect(evaluation.cases.every((item) => item.passed)).toBe(true);
  });
});
