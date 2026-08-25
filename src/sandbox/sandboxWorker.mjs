import { readFileSync } from "node:fs";
import vm from "node:vm";

const targetPath = process.argv[2];
const source = readFileSync(targetPath, "utf8");
let outputBytes = 0;
const outputLimit = 16_384;

function send(message) {
  if (process.send) process.send(message);
}

function safeLog(...values) {
  const line = values.map((value) => String(value)).join(" ").slice(0, 1_000);
  const bytes = Buffer.byteLength(line, "utf8");
  if (outputBytes + bytes > outputLimit) return;
  outputBytes += bytes;
  send({ type: "log", line });
}

const sandbox = Object.create(null);
sandbox.console = Object.freeze({ log: safeLog, warn: safeLog, error: safeLog });
const context = vm.createContext(sandbox, {
  name: "paychaos-target",
  codeGeneration: { strings: false, wasm: false }
});

try {
  const load = new vm.Script(`"use strict";\n${source}`, {
    filename: "selected-target.js"
  });
  load.runInContext(context, { timeout: 100 });

  const target = context.paychaosTarget;
  if (
    !target ||
    typeof target !== "object" ||
    typeof target.handle !== "function" ||
    typeof target.snapshot !== "function"
  ) {
    throw new Error("Target must define globalThis.paychaosTarget with handle() and snapshot().");
  }
  send({ type: "ready" });
} catch (error) {
  send({
    type: "fatal",
    error: error instanceof Error ? error.message : "Target initialization failed."
  });
}

process.on("message", (message) => {
  if (!message || typeof message !== "object" || typeof message.id !== "number") return;

  try {
    context.__paychaosInput = structuredClone(message.input);
    const operation = message.operation === "snapshot" ? "snapshot" : "handle";
    const call = new vm.Script(
      `globalThis.__paychaosOutput = globalThis.paychaosTarget.${operation}(globalThis.__paychaosInput)`
    );
    call.runInContext(context, { timeout: 100 });
    const output = context.__paychaosOutput;
    if (output && typeof output.then === "function") {
      throw new Error("Sandbox target methods must be synchronous.");
    }
    send({ type: "result", id: message.id, output: structuredClone(output) });
  } catch (error) {
    send({
      type: "result",
      id: message.id,
      error: error instanceof Error ? error.message : "Target operation failed."
    });
  } finally {
    delete context.__paychaosInput;
    delete context.__paychaosOutput;
  }
});
