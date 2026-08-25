import { runScannerEvaluation } from "../evaluation/scannerEvaluation.js";

const evaluation = await runScannerEvaluation();
const json = process.argv.includes("--json");

if (json) {
  process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
} else {
  const repository = evaluation.repositoryClassification;
  const labels = evaluation.riskLabels;
  console.log("PayChaos scanner evaluation · bundled-v1");
  console.log(`Repositories  ${evaluation.repositories}`);
  console.log(`Accuracy      ${(repository.accuracy * 100).toFixed(1)}% (${repository.truePositive} TP · ${repository.trueNegative} TN · ${repository.falsePositive} FP · ${repository.falseNegative} FN)`);
  console.log(`Risk labels   ${(labels.precision * 100).toFixed(1)}% precision · ${(labels.recall * 100).toFixed(1)}% recall · ${(labels.f1 * 100).toFixed(1)}% F1`);
  for (const item of evaluation.cases) {
    console.log(`${item.passed ? "PASS" : "FAIL"}          ${item.fixture} · ${item.observedRiskIds.join(", ") || "no risks"}`);
  }
  console.log(`Caveat        ${evaluation.caveat}`);
}
