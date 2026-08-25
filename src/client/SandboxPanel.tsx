import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { SandboxRunResult } from "../sandbox/boundedRunner.js";

interface SandboxStatus {
  available: boolean;
  runtime: string;
  contract: string;
  policy: {
    maxWallMs: number;
    maxOperationCpuMs: number;
    maxMemoryMb: number;
    maxTotalBytes: number;
    childNetwork: "denied";
  };
}

export function SandboxPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [result, setResult] = useState<SandboxRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sandbox/status")
      .then((response) => response.json() as Promise<SandboxStatus>)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function execute(url: string, init: RequestInit = { method: "POST" }) {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(url, init);
      const payload = (await response.json()) as SandboxRunResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Sandbox execution failed.");
      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Sandbox execution failed.");
    } finally {
      setRunning(false);
    }
  }

  async function runSelectedTarget(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(?:js|mjs)$/i.test(file.name)) {
      setError("Choose a JavaScript target that follows the PayChaos sandbox contract.");
      return;
    }
    await execute("/api/sandbox/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entry: file.name,
        files: [{ path: file.name, content: await file.text() }]
      })
    });
  }

  return (
    <section className="panel sandbox-panel" id="sandbox">
      <div className="panel-heading sandbox-heading">
        <div>
          <span className="section-kicker">BOUNDED REPOSITORY EXECUTION</span>
          <h2>Run selected payment logic inside a disposable cage</h2>
        </div>
        <div className="sandbox-runtime">
          <span className="provider-dot online" />
          <div><strong>CONTAINMENT READY</strong><small>{status?.runtime ?? "checking runtime…"}</small></div>
        </div>
      </div>

      <div className="sandbox-actions">
        <div>
          <p>Only the selected target is copied. The child has no network, no host globals, read-only access to that file, and hard CPU, memory, output, request, and wall-clock limits.</p>
          <code>{status?.contract ?? "globalThis.paychaosTarget = { handle, snapshot }"}</code>
        </div>
        <div className="sandbox-buttons">
          <button onClick={() => void execute("/api/sandbox/demo/vulnerable")} disabled={running}>Run vulnerable target</button>
          <button onClick={() => void execute("/api/sandbox/demo/protected")} disabled={running}>Run protected target</button>
          <button className="sandbox-select" onClick={() => inputRef.current?.click()} disabled={running}>Choose target.js</button>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".js,.mjs" onChange={(event) => void runSelectedTarget(event)} />
        </div>
      </div>

      {running ? <div className="repository-loading"><span /> Copying, attacking, observing, and destroying the workspace…</div> : null}
      {error ? <div className="repository-error">{error}</div> : null}

      {!running && !result ? (
        <div className="sandbox-policy">
          <span><b>{status?.policy.maxOperationCpuMs ?? 100}ms</b> operation CPU</span>
          <span><b>{status?.policy.maxWallMs ?? 3000}ms</b> total wall time</span>
          <span><b>{status?.policy.maxMemoryMb ?? 64}MB</b> child heap</span>
          <span><b>DENIED</b> child network</span>
          <span><b>{Math.round((status?.policy.maxTotalBytes ?? 500000) / 1000)}KB</b> source ceiling</span>
        </div>
      ) : null}

      {result ? (
        <div className="sandbox-result" aria-live="polite">
          <div className={`sandbox-verdict ${result.status}`}>
            <span>INV-001</span><strong>{result.status === "passed" ? "SURVIVED" : "FAILED"}</strong>
            <small>{result.invariant.observed} fulfilment{result.invariant.observed === "1" ? "" : "s"} observed</small>
          </div>
          <div><span>TRANSPORT</span><strong>{result.execution.transport}</strong><small>{result.execution.requests} requests · {result.execution.stateReads} state read</small></div>
          <div><span>DISPOSABLE FS</span><strong>{result.workspaceRemoved ? "REMOVED" : "CHECK FAILED"}</strong><small>{result.filesCopied} file · {result.bytesCopied} bytes</small></div>
          <div><span>CHILD CAPABILITIES</span><strong>NETWORK {result.execution.bounds.childNetwork.toUpperCase()}</strong><small>{result.execution.bounds.childFilesystem}</small></div>
        </div>
      ) : null}
    </section>
  );
}
