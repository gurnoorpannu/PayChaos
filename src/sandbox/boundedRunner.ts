import { fork, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSignedWebhookRequest, demoWebhookSecret, verifyRazorpayWebhook } from "../core/razorpay.js";
import type { PaymentWebhook } from "../core/types.js";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 100_000;
const MAX_TOTAL_BYTES = 500_000;
const MAX_REQUEST_BYTES = 64_000;
const MAX_WALL_MS = 3_000;
const MAX_OUTPUT_BYTES = 16_384;

export const sandboxPolicy = {
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxWallMs: MAX_WALL_MS,
  maxOperationCpuMs: 100,
  maxMemoryMb: 64,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  childNetwork: "denied" as const,
  childFilesystem: "read selected target only" as const
};

export interface SandboxSourceFile {
  path: string;
  content: string;
}

export interface SandboxRunResult {
  id: string;
  status: "passed" | "failed";
  target: string;
  filesCopied: number;
  bytesCopied: number;
  workspaceRemoved: boolean;
  execution: {
    transport: "HTTP + isolated IPC";
    requests: number;
    stateReads: number;
    durationMs: number;
    bounds: {
      wallMs: number;
      operationCpuMs: number;
      memoryMb: number;
      outputBytes: number;
      requestBytes: number;
      childNetwork: "denied";
      childFilesystem: "read selected target only";
    };
  };
  invariant: {
    id: "INV-001";
    expression: "fulfilments(payment_id).count <= 1";
    expected: "≤ 1";
    observed: string;
    passed: boolean;
  };
  evidence: {
    firstDelivery: "client timeout after commit";
    retryStatus: number;
    eventId: string;
    fulfilments: unknown[];
  };
  logs: string[];
}

export class SandboxRunError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_target" | "limit_exceeded" | "target_failed" | "timed_out"
  ) {
    super(message);
    this.name = "SandboxRunError";
  }
}

interface WorkerMessage {
  type: "ready" | "fatal" | "result" | "log";
  id?: number;
  output?: unknown;
  error?: string;
  line?: string;
}

function validRelativePath(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    candidate.length <= 240 &&
    !path.isAbsolute(candidate) &&
    !candidate.split(/[\\/]/).includes("..") &&
    /^[a-zA-Z0-9._/\\-]+$/.test(candidate)
  );
}

function validateInput(files: SandboxSourceFile[], entry: string) {
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new SandboxRunError(`Provide between 1 and ${MAX_FILES} JavaScript files.`, "limit_exceeded");
  }
  if (!validRelativePath(entry) || !/\.(?:js|mjs)$/.test(entry)) {
    throw new SandboxRunError("The sandbox entry must be a relative .js or .mjs path.", "invalid_target");
  }

  let totalBytes = 0;
  const names = new Set<string>();
  for (const file of files) {
    if (!validRelativePath(file.path) || !/\.(?:js|mjs)$/.test(file.path)) {
      throw new SandboxRunError("Every sandbox file must have a safe relative JavaScript path.", "invalid_target");
    }
    if (names.has(file.path)) {
      throw new SandboxRunError("Sandbox file paths must be unique.", "invalid_target");
    }
    names.add(file.path);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new SandboxRunError(`A sandbox file exceeded ${MAX_FILE_BYTES} bytes.`, "limit_exceeded");
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new SandboxRunError(`Sandbox sources exceeded ${MAX_TOTAL_BYTES} bytes.`, "limit_exceeded");
  }
  if (!names.has(entry)) {
    throw new SandboxRunError("The sandbox entry was not included in the selected files.", "invalid_target");
  }
  return totalBytes;
}

function permissionFlag(): string {
  return process.allowedNodeEnvironmentFlags.has("--permission")
    ? "--permission"
    : "--experimental-permission";
}

function startWorker(workerPath: string, targetPath: string) {
  return fork(workerPath, [targetPath], {
    execArgv: [
      permissionFlag(),
      `--allow-fs-read=${workerPath}`,
      `--allow-fs-read=${targetPath}`,
      "--max-old-space-size=64",
      "--disable-proto=throw"
    ],
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
}

function workerClient(child: ChildProcess, logs: string[]) {
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  let readyResolve: () => void;
  let readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const append = (chunk: Buffer | string) => {
    const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(logs.join("\n"), "utf8");
    if (remaining <= 0) return;
    logs.push(String(chunk).slice(0, remaining));
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("message", (incoming: WorkerMessage) => {
    if (incoming.type === "ready") readyResolve();
    if (incoming.type === "fatal") readyReject(new Error(incoming.error ?? "Target failed to initialize."));
    if (incoming.type === "log" && incoming.line) append(incoming.line);
    if (incoming.type === "result" && incoming.id) {
      const request = pending.get(incoming.id);
      if (!request) return;
      pending.delete(incoming.id);
      if (incoming.error) request.reject(new Error(incoming.error));
      else request.resolve(incoming.output);
    }
  });
  child.once("exit", (code) => {
    const error = new Error(`Sandbox target exited with code ${code ?? "unknown"}.`);
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  return {
    ready,
    call(operation: "handle" | "snapshot", input: unknown): Promise<unknown> {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ id, operation, input }, (error) => {
          if (!error) return;
          pending.delete(id);
          reject(error);
        });
      });
    }
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sandbox gateway did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new SandboxRunError("Sandbox request exceeded its byte limit.", "limit_exceeded"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function runBoundedNodeCampaign(
  files: SandboxSourceFile[],
  entry: string
): Promise<SandboxRunResult> {
  const bytesCopied = validateInput(files, entry);
  const started = Date.now();
  const workspace = await mkdtemp(path.join(tmpdir(), "paychaos-run-"));
  const workerPath = fileURLToPath(new URL("./sandboxWorker.mjs", import.meta.url));
  const logs: string[] = [];
  let child: ChildProcess | undefined;
  let server: Server | undefined;
  let result: Omit<SandboxRunResult, "workspaceRemoved"> | undefined;
  let runError: unknown;
  const deadline = AbortSignal.timeout(MAX_WALL_MS);

  try {
    for (const file of files) {
      const destination = path.join(workspace, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { encoding: "utf8", mode: 0o400 });
    }
    const targetPath = path.join(workspace, entry);
    child = startWorker(workerPath, targetPath);
    const client = workerClient(child, logs);
    const timed = <T>(promise: Promise<T>) => Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        deadline.addEventListener("abort", () => reject(
          new SandboxRunError("Sandbox campaign exceeded its wall-clock limit.", "timed_out")
        ), { once: true });
      })
    ]);
    await timed(client.ready);

    let requestCount = 0;
    let stateReads = 0;
    server = createServer(async (request, response) => {
      try {
        if (request.method === "POST" && request.url === "/webhooks/razorpay") {
          requestCount += 1;
          const rawBody = await readBody(request);
          const eventId = String(request.headers["x-razorpay-event-id"] ?? "");
          const signature = String(request.headers["x-razorpay-signature"] ?? "");
          const output = await timed(client.call("handle", {
            rawBody,
            eventId,
            signatureValid: verifyRazorpayWebhook(rawBody, signature, demoWebhookSecret)
          })) as { statusCode?: number } | undefined;
          if (request.headers["x-paychaos-fault"] === "timeout-after-commit") return;
          response.writeHead(output?.statusCode ?? 200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        if (request.method === "GET" && request.url === "/__paychaos/state") {
          stateReads += 1;
          const state = await timed(client.call("snapshot", {}));
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(state));
          return;
        }
        response.writeHead(404).end();
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Target failed." }));
      }
    });
    const baseUrl = await listen(server);

    const webhook: PaymentWebhook = {
      eventId: "evt_Q8m4Sandbox",
      event: "payment.captured",
      paymentId: "pay_Q8kwz3nE2s",
      orderId: "order_Q8krp5dH1a",
      amount: 50_000,
      currency: "INR",
      createdAt: 1_776_926_400
    };
    const signed = createSignedWebhookRequest(webhook);
    await fetch(`${baseUrl}/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signed.headers,
        "x-paychaos-fault": "timeout-after-commit"
      },
      body: signed.rawBody,
      signal: AbortSignal.timeout(30)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || !["AbortError", "TimeoutError"].includes(error.name)) throw error;
    });

    const retry = await timed(fetch(`${baseUrl}/webhooks/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signed.headers },
      body: signed.rawBody
    }));
    const retryBody = await retry.text();
    if (!retry.ok) {
      throw new SandboxRunError(
        `Sandbox target rejected the replay with HTTP ${retry.status}: ${retryBody.slice(0, 240)}`,
        "target_failed"
      );
    }
    const stateResponse = await timed(fetch(`${baseUrl}/__paychaos/state`));
    if (!stateResponse.ok) throw new Error("Sandbox state endpoint failed.");
    const state = await stateResponse.json() as { fulfilments?: unknown[] };
    const fulfilments = Array.isArray(state.fulfilments) ? state.fulfilments : [];
    const passed = fulfilments.length <= 1;

    result = {
      id: `sandbox_${Date.now().toString(36)}`,
      status: passed ? "passed" : "failed",
      target: entry,
      filesCopied: files.length,
      bytesCopied,
      execution: {
        transport: "HTTP + isolated IPC",
        requests: requestCount,
        stateReads,
        durationMs: Date.now() - started,
        bounds: {
          wallMs: MAX_WALL_MS,
          operationCpuMs: 100,
          memoryMb: 64,
          outputBytes: MAX_OUTPUT_BYTES,
          requestBytes: MAX_REQUEST_BYTES,
          childNetwork: "denied",
          childFilesystem: "read selected target only"
        }
      },
      invariant: {
        id: "INV-001",
        expression: "fulfilments(payment_id).count <= 1",
        expected: "≤ 1",
        observed: String(fulfilments.length),
        passed
      },
      evidence: {
        firstDelivery: "client timeout after commit",
        retryStatus: retry.status,
        eventId: webhook.eventId,
        fulfilments
      },
      logs
    };
  } catch (error) {
    runError = error;
  } finally {
    await close(server);
    if (child && !child.killed) child.kill("SIGKILL");
    await rm(workspace, { recursive: true, force: true });
  }

  let workspaceRemoved = false;
  try {
    await access(workspace);
  } catch {
    workspaceRemoved = true;
  }
  if (runError) {
    if (runError instanceof SandboxRunError) throw runError;
    throw new SandboxRunError(
      runError instanceof Error ? runError.message : "Sandbox target failed.",
      "target_failed"
    );
  }
  if (!result) throw new SandboxRunError("Sandbox produced no result.", "target_failed");
  return { ...result, workspaceRemoved };
}
