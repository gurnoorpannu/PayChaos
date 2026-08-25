import express from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCampaign } from "../core/campaigns.js";
import { runLiveDuplicateCampaign } from "../live/liveCampaign.js";
import {
  createRazorpayDiagnosticOrder,
  getRazorpayConnectorStatus,
  RazorpayConnectorError
} from "../connectors/razorpayTestMode.js";
import { IntelligenceService } from "../core/intelligence.js";
import { generateRegressionArtifact } from "../core/regressionGenerator.js";
import { getOverview, sourceForScenario } from "../core/catalog.js";
import {
  runBoundedNodeCampaign,
  sandboxPolicy,
  SandboxRunError,
  type SandboxSourceFile
} from "../sandbox/boundedRunner.js";
import {
  scanRepository,
  scanSourceFiles,
  type RepositoryScanResult,
  type RepositorySourceFile
} from "../core/repositoryScanner.js";
import type {
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
  if (value === "concurrent-delivery-race") return "concurrent-delivery-race";
  if (value === "forged-webhook") return "forged-webhook";
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
  response.json(getOverview());
});

app.get("/api/intelligence/status", (_request, response) => {
  response.json(intelligenceService.status());
});

app.get("/api/razorpay/status", (_request, response) => {
  response.json(getRazorpayConnectorStatus());
});

app.post("/api/razorpay/test-order", async (_request, response) => {
  try {
    response.json(await createRazorpayDiagnosticOrder());
  } catch (error) {
    if (error instanceof RazorpayConnectorError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }

    response.status(502).json({
      error: "The Razorpay Test Mode request could not be completed.",
      code: "request_failed"
    });
  }
});

app.get("/api/sandbox/status", (_request, response) => {
  response.json({
    available: true,
    runtime: `Node ${process.versions.node}`,
    contract: "synchronous globalThis.paychaosTarget.handle() + snapshot()",
    policy: sandboxPolicy
  });
});

async function sendSandboxRun(
  files: SandboxSourceFile[],
  entry: string,
  response: express.Response
) {
  try {
    response.json(await runBoundedNodeCampaign(files, entry));
  } catch (error) {
    if (error instanceof SandboxRunError) {
      response.status(error.code === "invalid_target" || error.code === "limit_exceeded" ? 400 : 422).json({
        error: error.message.slice(0, 500),
        code: error.code
      });
      return;
    }
    response.status(500).json({ error: "The bounded target could not be executed." });
  }
}

app.post("/api/sandbox/demo/:mode", async (request, response) => {
  const mode = request.params.mode === "protected" ? "protected" : "vulnerable";
  const content = await readFile(
    path.join(projectRoot, "fixtures", `sandbox-${mode}`, "target.js"),
    "utf8"
  );
  await sendSandboxRun([{ path: "target.js", content }], "target.js", response);
});

app.post("/api/sandbox/run", async (request, response) => {
  const files = Array.isArray(request.body?.files) ? request.body.files : [];
  const entry = typeof request.body?.entry === "string" ? request.body.entry : "";
  await sendSandboxRun(files, entry, response);
});

app.post("/api/repositories/demo/:mode", async (request, response) => {
  try {
    const fixture =
      request.params.mode === "protected"
        ? "protected-merchant"
        : request.params.mode === "signature"
          ? "signature-vulnerable"
        : request.params.mode === "crash"
          ? "crash-vulnerable"
          : request.params.mode === "race"
            ? "concurrency-vulnerable"
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
    source: sourceForScenario(scenario, mode)
  });
});

app.post("/api/campaigns", async (request, response) => {
  try {
    const mode: ProtectionMode =
      request.body?.mode === "protected" ? "protected" : "vulnerable";
    const scenario = parseScenario(request.body?.scenario);
    const report =
      scenario === "duplicate-after-timeout"
        ? await runLiveDuplicateCampaign(mode)
        : runCampaign(scenario, mode);
    response.json(report);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Campaign execution failed."
    });
  }
});

app.post("/api/regressions/:scenario", async (request, response) => {
  try {
    const scenario = parseScenario(request.params.scenario);
    const report =
      scenario === "duplicate-after-timeout"
        ? await runLiveDuplicateCampaign("vulnerable")
        : runCampaign(scenario, "vulnerable");
    response.json(generateRegressionArtifact(report));
  } catch {
    response.status(500).json({ error: "Regression artifact generation failed." });
  }
});

const staticDirectory = path.resolve(currentDirectory, "../../dist");
app.use(express.static(staticDirectory));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(staticDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`PayChaos API listening on http://localhost:${port}`);
});
