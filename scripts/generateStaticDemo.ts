import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOverview, sourceForScenario } from "../src/core/catalog.js";
import { runCampaign } from "../src/core/campaigns.js";
import { analyzeLocally } from "../src/core/intelligence.js";
import { generateRegressionArtifact } from "../src/core/regressionGenerator.js";
import { scanRepository } from "../src/core/repositoryScanner.js";
import type { ProtectionMode, ScenarioId } from "../src/core/types.js";
import { runLiveDuplicateCampaign } from "../src/live/liveCampaign.js";
import { getRazorpayConnectorStatus } from "../src/connectors/razorpayTestMode.js";
import {
  runBoundedNodeCampaign,
  sandboxPolicy
} from "../src/sandbox/boundedRunner.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(projectRoot, "public", "demo-api");
await mkdir(output, { recursive: true });

async function json(name: string, value: unknown) {
  await writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const scenarios: ScenarioId[] = [
  "duplicate-after-timeout",
  "out-of-order-regression",
  "crash-before-side-effect",
  "concurrent-delivery-race",
  "forged-webhook"
];
const modes: ProtectionMode[] = ["vulnerable", "protected"];
const failedReports = new Map<ScenarioId, Awaited<ReturnType<typeof runLiveDuplicateCampaign>>>();

await json("overview.json", getOverview());
await json("intelligence-status.json", {
  configured: false,
  provider: "local",
  model: "grounded-rules-v1",
  privacy: "Hosted read-only replay; no source leaves the browser."
});
await json("razorpay-status.json", {
  ...getRazorpayConnectorStatus({}),
  message: "Hosted replay cannot accept credentials. Run PayChaos locally for a real Test Mode round trip."
});
await json("sandbox-status.json", {
  available: true,
  readOnly: true,
  runtime: `Node ${process.versions.node} · pre-verified replay`,
  contract: "synchronous globalThis.paychaosTarget.handle() + snapshot()",
  policy: sandboxPolicy
});

for (const scenario of scenarios) {
  for (const mode of modes) {
    const report = scenario === "duplicate-after-timeout"
      ? await runLiveDuplicateCampaign(mode)
      : runCampaign(scenario, mode);
    await json(`campaign-${scenario}-${mode}.json`, report);
    await json(`source-${scenario}-${mode}.json`, {
      scenario,
      mode,
      source: sourceForScenario(scenario, mode)
    });
    if (mode === "vulnerable") failedReports.set(scenario, report);
  }
}

for (const scenario of scenarios) {
  await json(
    `regression-${scenario}.json`,
    generateRegressionArtifact(failedReports.get(scenario)!)
  );
}

const repositoryFixtures: Record<string, string> = {
  vulnerable: "vulnerable-merchant",
  protected: "protected-merchant",
  crash: "crash-vulnerable",
  race: "concurrency-vulnerable",
  signature: "signature-vulnerable"
};
for (const [mode, fixture] of Object.entries(repositoryFixtures)) {
  const scan = await scanRepository(path.join(projectRoot, "fixtures", fixture));
  scan.root = fixture;
  await json(`repository-${mode}.json`, {
    scanId: `hosted_${mode}`,
    scan,
    intelligence: analyzeLocally(scan)
  });
}

for (const mode of modes) {
  const content = await readFile(
    path.join(projectRoot, "fixtures", `sandbox-${mode}`, "target.js"),
    "utf8"
  );
  await json(
    `sandbox-${mode}.json`,
    await runBoundedNodeCampaign([{ path: "target.js", content }], "target.js")
  );
}

console.log(`Generated hosted replay data in ${path.relative(projectRoot, output)}`);
