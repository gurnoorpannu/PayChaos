import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  runBoundedNodeCampaign,
  SandboxRunError
} from "./boundedRunner.js";

async function fixture(mode: "vulnerable" | "protected") {
  const content = await readFile(
    new URL(`../../fixtures/sandbox-${mode}/target.js`, import.meta.url),
    "utf8"
  );
  return [{ path: "target.js", content }];
}

async function sandboxWorkspaces() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("paychaos-run-"));
}

describe("bounded Node target runner", () => {
  it("observes duplicate fulfilment through the copied vulnerable target", async () => {
    const result = await runBoundedNodeCampaign(await fixture("vulnerable"), "target.js");

    expect(result).toMatchObject({
      status: "failed",
      filesCopied: 1,
      workspaceRemoved: true,
      execution: {
        transport: "HTTP + isolated IPC",
        requests: 2,
        stateReads: 1,
        bounds: {
          memoryMb: 64,
          childNetwork: "denied",
          childFilesystem: "read selected target only"
        }
      },
      invariant: { id: "INV-001", observed: "2", passed: false }
    });
    expect(result.evidence.fulfilments).toHaveLength(2);
  });

  it("observes idempotency through the copied protected target", async () => {
    const result = await runBoundedNodeCampaign(await fixture("protected"), "target.js");

    expect(result.status).toBe("passed");
    expect(result.invariant).toMatchObject({ observed: "1", passed: true });
    expect(result.evidence.fulfilments).toHaveLength(1);
    expect(result.workspaceRemoved).toBe(true);
  });

  it("rejects traversal and oversized files before execution", async () => {
    await expect(
      runBoundedNodeCampaign([{ path: "../target.js", content: "" }], "../target.js")
    ).rejects.toMatchObject({ code: "invalid_target" });

    await expect(
      runBoundedNodeCampaign(
        [{ path: "target.js", content: "x".repeat(100_001) }],
        "target.js"
      )
    ).rejects.toMatchObject({ code: "limit_exceeded" });
  });

  it("denies host globals and removes the disposable workspace after failure", async () => {
    const before = await sandboxWorkspaces();
    const source = `globalThis.paychaosTarget = {
      handle() { return { statusCode: process.cwd() ? 200 : 500 }; },
      snapshot() { return { fulfilments: [] }; }
    };`;

    await expect(
      runBoundedNodeCampaign([{ path: "target.js", content: source }], "target.js")
    ).rejects.toBeInstanceOf(SandboxRunError);

    expect(await sandboxWorkspaces()).toEqual(before);
  });

  it("interrupts a target that exceeds its per-operation CPU budget", async () => {
    const source = `globalThis.paychaosTarget = {
      handle() { while (true) {} },
      snapshot() { return { fulfilments: [] }; }
    };`;

    await expect(
      runBoundedNodeCampaign([{ path: "target.js", content: source }], "target.js")
    ).rejects.toMatchObject({ code: "target_failed" });
  });
});
