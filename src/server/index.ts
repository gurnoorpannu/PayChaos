import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDuplicateAfterTimeoutCampaign } from "../core/engine.js";
import {
  protectedMerchantSource,
  vulnerableMerchantSource
} from "../core/sample.js";
import type { OverviewResponse, ProtectionMode } from "../core/types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(express.json());

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
    scenario: {
      id: "CHAOS-001",
      name: "Duplicate after post-commit timeout",
      description:
        "Lose the webhook acknowledgement after the merchant commits, then redeliver the identical Razorpay event.",
      operators: ["Deliver", "Commit", "Timeout", "Retry"]
    },
    source: vulnerableMerchantSource
  };
  response.json(overview);
});

app.get("/api/source/:mode", (request, response) => {
  const mode = request.params.mode === "protected" ? "protected" : "vulnerable";
  response.json({
    mode,
    source: mode === "protected" ? protectedMerchantSource : vulnerableMerchantSource
  });
});

app.post("/api/campaigns", (request, response) => {
  const mode: ProtectionMode =
    request.body?.mode === "protected" ? "protected" : "vulnerable";
  response.json(runDuplicateAfterTimeoutCampaign(mode));
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.resolve(currentDirectory, "../../../dist");
app.use(express.static(staticDirectory));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(staticDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`PayChaos API listening on http://localhost:${port}`);
});
