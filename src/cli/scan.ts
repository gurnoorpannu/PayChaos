import path from "node:path";
import { scanRepository } from "../core/repositoryScanner.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const target = args.find((argument) => !argument.startsWith("--")) ?? ".";

function printHumanReport(result: Awaited<ReturnType<typeof scanRepository>>) {
  const languages = Object.entries(result.languages)
    .sort(([, left], [, right]) => right - left)
    .map(([language, count]) => `${language}:${count}`)
    .join(" · ");

  console.log("\nPayChaos repository scan");
  console.log(`Target        ${result.root}`);
  console.log(`Files         ${result.filesScanned}${result.truncated ? " (scan limit reached)" : ""}`);
  console.log(`Languages     ${languages || "none"}`);
  console.log(`Providers     ${result.providers.join(", ") || "none detected"}`);
  console.log(`Webhook paths ${result.webhookSurfaces.length}`);
  console.log(`Static score  ${result.staticScore}/100`);

  for (const surface of result.webhookSurfaces) {
    console.log(`\n${surface.file}:${surface.line}  ${surface.route}`);
    console.log(`  events       ${surface.events.join(", ")}`);
    console.log(`  side effects ${surface.sideEffects.join(", ") || "none detected"}`);
    console.log(
      `  controls     signature=${surface.signatureVerification} event-id=${surface.eventIdIdempotency} transaction=${surface.transactionBoundary} monotonic=${surface.monotonicStateGuard} outbox=${surface.durableOutbox}`
    );
  }

  if (result.risks.length === 0) {
    console.log("\nNo static payment risks detected. Deterministic campaigns are still required.\n");
    return;
  }

  console.log(`\n${result.risks.length} hypothesis candidate${result.risks.length === 1 ? "" : "s"}`);
  for (const risk of result.risks) {
    console.log(`  [${risk.severity.toUpperCase()}] ${risk.title}`);
    console.log(`  ${risk.file}:${risk.line} → ${risk.suggestedScenario}`);
  }
  console.log("");
}

try {
  const result = await scanRepository(path.resolve(target));
  if (json) console.log(JSON.stringify(result, null, 2));
  else printHumanReport(result);
} catch (error) {
  console.error(
    `PayChaos could not scan the repository: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
