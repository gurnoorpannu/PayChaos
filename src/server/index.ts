import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCampaign } from "../core/campaigns.js";
import { IntelligenceService } from "../core/intelligence.js";
import {
  scanRepository,
  scanSourceFiles,
  type RepositoryScanResult,
  type RepositorySourceFile
} from "../core/repositoryScanner.js";
import {
  protectedCrashSource,
  protectedMerchantSource,
  protectedStateSource,
  vulnerableCrashSource,
  vulnerableStateSource,
  vulnerableMerchantSource
} from "../core/sample.js";
import type {
  OverviewResponse,
  ProtectionMode,
  ScenarioId
} from "../core/types.js";

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const app = express();
const port = Number(process.env.PORT ?? 8787);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
const intelligenceService = new IntelligenceService();
const recentScans = new Map<string, RepositoryScanResult>();

app.use(express.json({ limit: "3mb" }));

function rememberScan(scan: RepositoryScanResult): string {
  const scanId = `scan_${randomUUID().slice(0, 10)}`;
  recentScans.set(scanId, scan);
  if (recentScans.size > 20) recentScans.delete(recentScans.keys().next().value!);
  return scanId;
}

function parseScenario(value: unknown): ScenarioId {
  if (value === "out-of-order-regression") return "out-of-order-regression";
  if (value === "crash-before-side-effect") return "crash-before-side-effect";
  return "duplicate-after-timeout";
}

async function repositoryResponse(scan: RepositoryScanResult) {
  return {
    scanId: rememberScan(scan),
    scan,
    intelligence: await intelligenceService.analyze(scan, false)
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "paychaos", version: "0.1.0" });
});

app.get("/api/overview", (_request, response) => {
  const overview: OverviewResponse = {
    target: {
      name: "Acme Store",
      environment: "Razorpay Test Mode",
      stack: "Express · Prisma · PostgreSQL"
    },
    scenarios: [
      {
        id: "CHAOS-001",
        scenario: "duplicate-after-timeout",
        name: "Duplicate after post-commit timeout",
        description:
          "Lose the webhook acknowledgement after the merchant commits, then redeliver the identical Razorpay event.",
        operators: ["Deliver", "Commit", "Timeout", "Retry"]
      },
      {
        id: "CHAOS-002",
        scenario: "out-of-order-regression",
        name: "Out-of-order state regression",
        description:
          "Deliver capture first, then release an older delayed failure for the same payment.",
        operators: ["Capture", "Delay", "Stale failure", "Inspect"]
      },
      {
        id: "CHAOS-003",
        scenario: "crash-before-side-effect",
        name: "Crash before external side effect",
        description:
          "Crash after payment state commits but before shipment dispatch, then restart and replay delivery.",
        operators: ["Commit", "Crash", "Restart", "Recover"]
      }
    ],
    source: vulnerableMerchantSource
  };
  response.json(overview);
});

app.get("/api/intelligence/status", (_request, response) => {
  response.json(intelligenceService.status());
});

app.post("/api/repositories/demo/:mode", async (request, response) => {
  try {
    const fixture =
      request.params.mode === "protected"
        ? "protected-merchant"
        : request.params.mode === "crash"
          ? "crash-vulnerable"
          : "vulnerable-merchant";
    const scan = await scanRepository(path.join(projectRoot, "fixtures", fixture));
    response.json(await repositoryResponse(scan));
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to scan the demo repository."
    });
  }
});

app.post("/api/repositories/analyze", async (request, response) => {
  const incomingFiles = Array.isArray(request.body?.files) ? request.body.files : [];
  if (incomingFiles.length === 0 || incomingFiles.length > 500) {
    response.status(400).json({ error: "Provide between 1 and 500 bounded source files." });
    return;
  }

  const files: RepositorySourceFile[] = [];
  let totalBytes = 0;
  for (const candidate of incomingFiles) {
    if (
      !candidate ||
      typeof candidate.path !== "string" ||
      typeof candidate.content !== "string"
    ) {
      response.status(400).json({ error: "Every source file needs a path and text content." });
      return;
    }
    const bytes = Buffer.byteLength(candidate.content, "utf8");
    if (bytes > 150_000) continue;
    totalBytes += bytes;
    if (totalBytes > 2_000_000) {
      response.status(413).json({ error: "Repository source exceeds the 2 MB analysis limit." });
      return;
    }
    files.push({
      path: candidate.path.slice(0, 500),
      content: candidate.content,
      bytes
    });
  }

  if (files.length === 0) {
    response.status(400).json({ error: "No supported source files remained after applying limits." });
    return;
  }

  const scan = scanSourceFiles(files, "browser-selected repository");
  response.json(await repositoryResponse(scan));
});

app.post("/api/intelligence/hypothesize", async (request, response) => {
  const scanId = typeof request.body?.scanId === "string" ? request.body.scanId : "";
  const scan = recentScans.get(scanId);
  if (!scan) {
    response.status(404).json({ error: "That repository scan is no longer available." });
    return;
  }

  const intelligence = await intelligenceService.analyze(scan, true);
  response.json({ scanId, intelligence });
});

app.get("/api/source/:scenario/:mode", (request, response) => {
  const mode = request.params.mode === "protected" ? "protected" : "vulnerable";
  const scenario = parseScenario(request.params.scenario);
  response.json({
    mode,
    scenario,
    source:
      scenario === "crash-before-side-effect"
        ? mode === "protected"
          ? protectedCrashSource
          : vulnerableCrashSource
        : scenario === "out-of-order-regression"
        ? mode === "protected"
          ? protectedStateSource
          : vulnerableStateSource
        : mode === "protected"
          ? protectedMerchantSource
          : vulnerableMerchantSource
  });
});

app.post("/api/campaigns", (request, response) => {
  const mode: ProtectionMode =
    request.body?.mode === "protected" ? "protected" : "vulnerable";
  const scenario = parseScenario(request.body?.scenario);
  response.json(runCampaign(scenario, mode));
});

const staticDirectory = path.resolve(currentDirectory, "../../dist");
app.use(express.static(staticDirectory));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(staticDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`PayChaos API listening on http://localhost:${port}`);
});
