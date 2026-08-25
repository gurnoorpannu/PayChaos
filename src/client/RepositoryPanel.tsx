import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  IntelligenceResult,
  IntelligenceStatus
} from "../core/intelligence.js";
import type { RepositoryScanResult } from "../core/repositoryScanner.js";
import type { ScenarioId } from "../core/types.js";
import { apiFetch, readOnlyDemo } from "./api.js";

interface RepositoryResponse {
  scanId: string;
  scan: RepositoryScanResult;
  intelligence: IntelligenceResult;
}

interface RepositoryPanelProps {
  onRunScenario: (scenario: ScenarioId) => void;
}

const supportedExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|go|rb|php|cs)$/i;
const directoryAttributes = {
  webkitdirectory: "",
  directory: ""
} as React.InputHTMLAttributes<HTMLInputElement>;

function compactRoot(root: string) {
  const pieces = root.split(/[\\/]/).filter(Boolean);
  return pieces.at(-1) ?? root;
}

export function RepositoryPanel({ onRunScenario }: RepositoryPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<IntelligenceStatus | null>(null);
  const [result, setResult] = useState<RepositoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/intelligence/status")
      .then((response) => response.json() as Promise<IntelligenceStatus>)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function requestScan(url: string, init?: RequestInit) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(url, init);
      const payload = (await response.json()) as RepositoryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Repository analysis failed.");
      setResult(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Repository analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function scanDemo(mode: "vulnerable" | "protected" | "crash" | "race") {
    await requestScan(`/api/repositories/demo/${mode}`, { method: "POST" });
  }

  async function selectRepository(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
      .filter((file) => supportedExtension.test(file.name))
      .slice(0, 500);
    event.target.value = "";

    if (selected.length === 0) {
      setError("No supported source files were selected.");
      return;
    }

    const files = await Promise.all(
      selected.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        content: await file.text()
      }))
    );
    await requestScan("/api/repositories/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files })
    });
  }

  async function enrichWithAI() {
    if (!result) return;
    setEnriching(true);
    setError(null);
    try {
      const response = await apiFetch("/api/intelligence/hypothesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId: result.scanId })
      });
      const payload = (await response.json()) as {
        intelligence?: IntelligenceResult;
        error?: string;
      };
      if (!response.ok || !payload.intelligence) {
        throw new Error(payload.error ?? "AI enrichment failed.");
      }
      setResult({ ...result, intelligence: payload.intelligence });
    } catch (enrichmentError) {
      setError(
        enrichmentError instanceof Error ? enrichmentError.message : "AI enrichment failed."
      );
    } finally {
      setEnriching(false);
    }
  }

  return (
    <section className="panel repository-panel" id="repository">
      <div className="panel-heading repository-heading">
        <div>
          <span className="section-kicker">REPOSITORY INTELLIGENCE</span>
          <h2>Turn payment code into failure hypotheses</h2>
        </div>
        <div className="provider-state">
          <span className={status?.configured ? "provider-dot online" : "provider-dot"} />
          <div>
            <strong>{status?.configured ? "OPENAI READY" : "LOCAL ANALYZER"}</strong>
            <small>{status?.model ?? "checking provider…"}</small>
          </div>
        </div>
      </div>

      <div className="repository-actions">
        <div>
          <strong>Scan a codebase</strong>
          <p>Source is parsed locally. Target dependencies and scripts are never executed.</p>
        </div>
        <div className="repository-buttons">
          <button onClick={() => void scanDemo("vulnerable")} disabled={loading}>
            Scan vulnerable demo
          </button>
          <button onClick={() => void scanDemo("protected")} disabled={loading}>
            Scan protected demo
          </button>
          <button onClick={() => void scanDemo("crash")} disabled={loading}>
            Scan crash-gap demo
          </button>
          <button onClick={() => void scanDemo("race")} disabled={loading}>
            Scan race demo
          </button>
          <button className="repository-upload" onClick={() => inputRef.current?.click()} disabled={loading || readOnlyDemo}>
            {readOnlyDemo ? "Local API required" : "Choose local repository"}
          </button>
          <input
            {...directoryAttributes}
            ref={inputRef}
            className="visually-hidden"
            type="file"
            multiple
            onChange={(event) => void selectRepository(event)}
          />
        </div>
      </div>

      {error ? <div className="repository-error">{error}</div> : null}
      {loading ? (
        <div className="repository-loading">
          <span /> Mapping payment surfaces, controls, and side effects…
        </div>
      ) : null}

      {!loading && !result ? (
        <div className="repository-empty">
          <div className="empty-map">
            <span>SOURCE</span><i>→</i><span>SURFACES</span><i>→</i><span>HYPOTHESES</span><i>→</i><span>CAMPAIGNS</span>
          </div>
          <p>Start with a bundled fixture or choose a local repository. Static output remains a hypothesis until a deterministic campaign proves it.</p>
        </div>
      ) : null}

      {result ? (
        <div className="repository-results">
          <div className="scan-summary">
            <div className={`static-score ${result.scan.staticScore >= 80 ? "safe" : "risk"}`}>
              <strong>{result.scan.staticScore}</strong><span>/100</span>
              <small>STATIC PRIORITY</small>
            </div>
            <div className="scan-stat"><span>TARGET</span><strong>{compactRoot(result.scan.root)}</strong></div>
            <div className="scan-stat"><span>FILES READ</span><strong>{result.scan.filesScanned}</strong></div>
            <div className="scan-stat"><span>PAYMENT SURFACES</span><strong>{result.scan.webhookSurfaces.length}</strong></div>
            <div className="scan-stat"><span>RISK CANDIDATES</span><strong>{result.scan.risks.length}</strong></div>
          </div>

          <div className="intelligence-summary">
            <div>
              <span className="section-kicker">{result.intelligence.provider === "openai" ? "AI ANALYSIS" : "GROUNDED FALLBACK"}</span>
              <p>{result.intelligence.summary}</p>
              {result.intelligence.fallbackReason ? <small>Fallback: {result.intelligence.fallbackReason}</small> : null}
            </div>
            {status?.configured && result.intelligence.provider !== "openai" ? (
              <button className="ai-enrich" onClick={() => void enrichWithAI()} disabled={enriching}>
                {enriching ? "Enriching…" : "Send scan metadata to OpenAI"}
              </button>
            ) : (
              <span className="privacy-note">
                {result.intelligence.provider === "openai"
                  ? `${result.intelligence.model} · source stayed local`
                  : readOnlyDemo
                    ? "Hosted replay · model calls disabled"
                    : "Add OPENAI_API_KEY for optional AI enrichment"}
              </span>
            )}
          </div>

          <div className="hypothesis-grid">
            {result.intelligence.hypotheses.length === 0 ? (
              <div className="no-hypotheses">
                <strong>No supported static risk pattern detected</strong>
                <p>This is not a pass. Dynamic campaigns remain necessary.</p>
              </div>
            ) : result.intelligence.hypotheses.map((hypothesis) => {
              const runnable = hypothesis.scenario !== "forged-webhook";
              return (
                <article className="hypothesis-card" key={hypothesis.id}>
                  <div className="hypothesis-meta">
                    <span>{hypothesis.id}</span>
                    <strong>{Math.round(hypothesis.confidence * 100)}% CONFIDENCE</strong>
                  </div>
                  <h3>{hypothesis.title}</h3>
                  <p>{hypothesis.financialImpact}</p>
                  <code>{hypothesis.evidence[0]}</code>
                  <button
                    disabled={!runnable}
                    onClick={() => runnable && onRunScenario(hypothesis.scenario as ScenarioId)}
                  >
                    {runnable ? "Run deterministic campaign →" : "Campaign coming next"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
