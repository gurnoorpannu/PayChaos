import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rb",
  ".php",
  ".cs"
]);

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);

export interface RepositorySourceFile {
  path: string;
  content: string;
  bytes: number;
}

export interface WebhookSurface {
  file: string;
  line: number;
  route: string;
  events: string[];
  signatureVerification: boolean;
  eventIdIdempotency: boolean;
  atomicEventClaim: boolean;
  transactionBoundary: boolean;
  monotonicStateGuard: boolean;
  durableOutbox: boolean;
  sideEffects: string[];
}

export interface RepositoryRisk {
  id:
    | "missing-signature-verification"
    | "missing-event-idempotency"
    | "non-atomic-idempotency-check"
    | "non-monotonic-payment-state"
    | "non-atomic-external-side-effect";
  severity: "critical" | "high";
  title: string;
  file: string;
  line: number;
  reason: string;
  suggestedScenario:
    | "forged-webhook"
    | "duplicate-after-timeout"
    | "concurrent-delivery-race"
    | "out-of-order-regression"
    | "crash-before-side-effect";
}

export interface RepositoryScanResult {
  root: string;
  filesScanned: number;
  bytesRead: number;
  truncated: boolean;
  languages: Record<string, number>;
  providers: string[];
  webhookSurfaces: WebhookSurface[];
  risks: RepositoryRisk[];
  staticScore: number;
}

interface ScanOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split("\n").length;
}

function uniqueMatches(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((match) => match[0]).filter(
    (value, index, values) => values.indexOf(value) === index
  );
}

function detectRoute(content: string): { route: string; index: number } {
  const patterns = [
    /(?:router|app)\.post\(\s*["'`]([^"'`]+)["'`]/i,
    /@(?:app|router)\.post\(\s*["'`]([^"'`]+)["'`]/i,
    /path\(\s*["'`]([^"'`]*webhook[^"'`]*)["'`]/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) return { route: match[1], index: match.index };
  }

  const webhookIndex = content.toLowerCase().indexOf("webhook");
  return { route: "webhook handler", index: Math.max(0, webhookIndex) };
}

function detectSideEffects(content: string): string[] {
  const detections: Array<[RegExp, string]> = [
    [/\.fulfilments?\.(?:create|insert)|fulfilments?\.create/i, "create fulfilment"],
    [/\.orders?\.(?:create|insert)|orders?\.create/i, "create order"],
    [/\.payments?\.(?:update|save)|payments?\.update/i, "update payment state"],
    [/queue(?:Shipment|Fulfilment)|ship(?:Order|ment)|dispatchOrder/i, "queue shipment"],
    [/send(?:Email|Sms|Notification)|publish\(/i, "emit external notification"]
  ];

  return detections
    .filter(([pattern]) => pattern.test(content))
    .map(([, label]) => label);
}

export function scanSourceFiles(
  files: RepositorySourceFile[],
  root = "provided sources",
  truncated = false
): RepositoryScanResult {
  const webhookSurfaces: WebhookSurface[] = [];
  const risks: RepositoryRisk[] = [];
  const languages: Record<string, number> = {};
  const providers = new Set<string>();

  for (const file of files) {
    const extension = path.extname(file.path).slice(1).toLowerCase() || "unknown";
    languages[extension] = (languages[extension] ?? 0) + 1;

    if (/razorpay/i.test(file.content)) providers.add("Razorpay");

    const events = uniqueMatches(
      file.content,
      /(?:payment|order|refund)\.(?:authorized|captured|failed|paid|processed|refunded)/g
    );
    const webhookLike = /webhook/i.test(file.content) && events.length > 0;
    if (!webhookLike) continue;

    const route = detectRoute(file.content);
    const sideEffects = detectSideEffects(file.content);
    const surface: WebhookSurface = {
      file: file.path,
      line: lineOf(file.content, route.index),
      route: route.route,
      events,
      signatureVerification:
        /validateWebhookSignature|verify(?:Razorpay)?Signature|x-razorpay-signature|timingSafeEqual/i.test(
          file.content
        ),
      eventIdIdempotency:
        /x-razorpay-event-id/i.test(file.content) &&
        /unique|upsert|processedEvents?|webhookEvents?|duplicate/i.test(file.content),
      atomicEventClaim:
        /x-razorpay-event-id/i.test(file.content) &&
        /unique|upsert/i.test(file.content) &&
        /\$transaction|transaction\.atomic|withTransaction|BEGIN TRANSACTION|@Transactional/i.test(
          file.content
        ),
      transactionBoundary:
        /\$transaction|transaction\.atomic|withTransaction|BEGIN TRANSACTION|@Transactional/i.test(
          file.content
        ),
      monotonicStateGuard:
        /CAPTURED[^\n]{0,120}(?:payment\.failed|FAILED)[^\n]{0,80}(?:return|ignore|skip)|monotonic/i.test(
          file.content
        ),
      durableOutbox:
        /outbox\.(?:create|insert)|outboxWorker|transactional outbox/i.test(file.content) &&
        /\$transaction|transaction\.atomic|withTransaction|BEGIN TRANSACTION|@Transactional/i.test(
          file.content
        ),
      sideEffects
    };
    webhookSurfaces.push(surface);

    if (!surface.signatureVerification) {
      risks.push({
        id: "missing-signature-verification",
        severity: "critical",
        title: "Webhook authenticity is not verified",
        file: file.path,
        line: surface.line,
        reason: "A payment webhook surface was detected without a raw-body signature verification boundary.",
        suggestedScenario: "forged-webhook"
      });
    }

    const createsIrreversibleWork = sideEffects.some((effect) =>
      ["create fulfilment", "create order", "queue shipment"].includes(effect)
    );
    if (
      events.includes("payment.captured") &&
      createsIrreversibleWork &&
      !surface.eventIdIdempotency
    ) {
      risks.push({
        id: "missing-event-idempotency",
        severity: "critical",
        title: "Captured payment can repeat an irreversible side effect",
        file: file.path,
        line: surface.line,
        reason: "The handler creates fulfilment work but no unique x-razorpay-event-id claim was detected.",
        suggestedScenario: "duplicate-after-timeout"
      });
    }

    if (
      events.includes("payment.captured") &&
      createsIrreversibleWork &&
      surface.eventIdIdempotency &&
      !surface.atomicEventClaim
    ) {
      risks.push({
        id: "non-atomic-idempotency-check",
        severity: "critical",
        title: "Idempotency check can lose a concurrency race",
        file: file.path,
        line: surface.line,
        reason:
          "Event history is checked before fulfilment, but no transactional unique claim protects the read-write gap.",
        suggestedScenario: "concurrent-delivery-race"
      });
    }

    if (
      events.includes("payment.captured") &&
      surface.eventIdIdempotency &&
      surface.transactionBoundary &&
      sideEffects.includes("queue shipment") &&
      !surface.durableOutbox
    ) {
      risks.push({
        id: "non-atomic-external-side-effect",
        severity: "high",
        title: "A crash can strand a committed payment side effect",
        file: file.path,
        line: surface.line,
        reason:
          "The event is claimed transactionally, but shipment dispatch has no durable outbox handoff.",
        suggestedScenario: "crash-before-side-effect"
      });
    }

    if (
      events.includes("payment.captured") &&
      events.includes("payment.failed") &&
      sideEffects.includes("update payment state") &&
      !surface.monotonicStateGuard
    ) {
      risks.push({
        id: "non-monotonic-payment-state",
        severity: "high",
        title: "Delivery order can overwrite payment truth",
        file: file.path,
        line: surface.line,
        reason: "Captured and failed events both update state, but no monotonic transition guard was detected.",
        suggestedScenario: "out-of-order-regression"
      });
    }
  }

  const penalty = risks.reduce(
    (total, risk) => total + (risk.severity === "critical" ? 28 : 18),
    0
  );

  return {
    root,
    filesScanned: files.length,
    bytesRead: files.reduce((total, file) => total + file.bytes, 0),
    truncated,
    languages,
    providers: [...providers],
    webhookSurfaces,
    risks,
    staticScore: Math.max(0, 100 - penalty)
  };
}

export async function scanRepository(
  rootPath: string,
  options: ScanOptions = {}
): Promise<RepositoryScanResult> {
  const maxFiles = options.maxFiles ?? 500;
  const maxTotalBytes = options.maxTotalBytes ?? 2_000_000;
  const maxFileBytes = options.maxFileBytes ?? 150_000;
  const resolvedRoot = await realpath(path.resolve(rootPath));
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error("Scan target must be a directory.");

  const files: RepositorySourceFile[] = [];
  const pending = [resolvedRoot];
  let totalBytes = 0;
  let truncated = false;

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) pending.push(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile() || !supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      if (files.length >= maxFiles) {
        truncated = true;
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const fileStat = await stat(absolutePath);
      if (fileStat.size > maxFileBytes || totalBytes + fileStat.size > maxTotalBytes) {
        truncated = true;
        continue;
      }

      const content = await readFile(absolutePath, "utf8");
      const relativePath = path.relative(resolvedRoot, absolutePath);
      files.push({ path: relativePath, content, bytes: fileStat.size });
      totalBytes += fileStat.size;
    }
  }

  return scanSourceFiles(files, resolvedRoot, truncated);
}
