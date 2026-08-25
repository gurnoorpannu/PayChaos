import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../core/repositoryScanner.js";

interface EvaluationCase {
  fixture: string;
  expectedRiskIds: string[];
}

const corpus: EvaluationCase[] = [
  {
    fixture: "vulnerable-merchant",
    expectedRiskIds: ["missing-event-idempotency", "non-monotonic-payment-state"]
  },
  { fixture: "protected-merchant", expectedRiskIds: [] },
  { fixture: "crash-vulnerable", expectedRiskIds: ["non-atomic-external-side-effect"] },
  { fixture: "crash-protected", expectedRiskIds: [] },
  { fixture: "concurrency-vulnerable", expectedRiskIds: ["non-atomic-idempotency-check"] },
  { fixture: "concurrency-protected", expectedRiskIds: [] }
];

export interface ScannerEvaluationResult {
  corpus: "bundled-v1";
  repositories: number;
  repositoryClassification: {
    truePositive: number;
    trueNegative: number;
    falsePositive: number;
    falseNegative: number;
    accuracy: number;
  };
  riskLabels: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
  };
  cases: Array<{
    fixture: string;
    expectedRiskIds: string[];
    observedRiskIds: string[];
    staticScore: number;
    passed: boolean;
  }>;
  caveat: string;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

export async function runScannerEvaluation(
  fixturesRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures"
  )
): Promise<ScannerEvaluationResult> {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let labelTruePositive = 0;
  let labelFalsePositive = 0;
  let labelFalseNegative = 0;

  const cases = [];
  for (const item of corpus) {
    const scan = await scanRepository(path.join(fixturesRoot, item.fixture));
    const observedRiskIds = scan.risks.map((risk) => risk.id).sort();
    const expectedRiskIds = [...item.expectedRiskIds].sort();
    const observed = new Set<string>(observedRiskIds);
    const expected = new Set<string>(expectedRiskIds);
    const expectedPositive = expected.size > 0;
    const observedPositive = observed.size > 0;

    if (expectedPositive && observedPositive) truePositive += 1;
    else if (!expectedPositive && !observedPositive) trueNegative += 1;
    else if (!expectedPositive && observedPositive) falsePositive += 1;
    else falseNegative += 1;

    for (const risk of observed) {
      if (expected.has(risk)) labelTruePositive += 1;
      else labelFalsePositive += 1;
    }
    for (const risk of expected) {
      if (!observed.has(risk)) labelFalseNegative += 1;
    }

    cases.push({
      fixture: item.fixture,
      expectedRiskIds,
      observedRiskIds,
      staticScore: scan.staticScore,
      passed:
        expectedRiskIds.length === observedRiskIds.length &&
        expectedRiskIds.every((risk, index) => risk === observedRiskIds[index])
    });
  }

  const precision = ratio(labelTruePositive, labelTruePositive + labelFalsePositive);
  const recall = ratio(labelTruePositive, labelTruePositive + labelFalseNegative);

  return {
    corpus: "bundled-v1",
    repositories: corpus.length,
    repositoryClassification: {
      truePositive,
      trueNegative,
      falsePositive,
      falseNegative,
      accuracy: ratio(truePositive + trueNegative, corpus.length)
    },
    riskLabels: {
      truePositive: labelTruePositive,
      falsePositive: labelFalsePositive,
      falseNegative: labelFalseNegative,
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : Number((2 * precision * recall / (precision + recall)).toFixed(4))
    },
    cases,
    caveat: "This is a small, curated fixture corpus. Metrics verify regressions; they do not estimate performance on arbitrary production repositories."
  };
}
