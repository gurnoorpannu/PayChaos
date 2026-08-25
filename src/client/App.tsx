import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CampaignReport,
  OverviewResponse,
  ProtectionMode,
  ScenarioId,
  TimelineEntry
} from "../core/types.js";
import { RepositoryPanel } from "./RepositoryPanel.js";
import { RazorpayPanel } from "./RazorpayPanel.js";

const kindLabel: Record<TimelineEntry["kind"], string> = {
  analysis: "AI",
  webhook: "WEBHOOK",
  database: "DATABASE",
  network: "NETWORK",
  invariant: "ORACLE"
};

const scenarioCategory: Record<ScenarioId, string> = {
  "duplicate-after-timeout": "IDEMPOTENCY",
  "out-of-order-regression": "STATE ORDERING",
  "crash-before-side-effect": "CRASH RECOVERY",
  "concurrent-delivery-race": "CONCURRENCY"
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    play: <path d="m7 4 13 8-13 8V4Z" />,
    shield: <path d="M12 3 4.5 6v5.2c0 4.7 3.1 7.9 7.5 9.8 4.4-1.9 7.5-5.1 7.5-9.8V6L12 3Z" />,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 5h3a4 4 0 0 1 4 4v5a4 4 0 0 0 1 2.7M6 7v10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m15 8 4 4-4 4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    code: <><path d="m8 9-3 3 3 3" /><path d="m16 9 3 3-3 3" /><path d="m14 5-4 14" /></>,
    db: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
    spark: <><path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3Z" /><path d="m18.5 15 .7 2.2 1.8.8-1.8.8-.7 2.2-.7-2.2L16 18l1.8-.8.7-2.2Z" /></>
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function ScoreGauge({ value }: { value: number }) {
  const tone = value >= 80 ? "var(--green)" : "var(--danger)";
  return (
    <div
      className="score-gauge"
      style={{
        background: `conic-gradient(${tone} ${value * 3.6}deg, var(--line) 0deg)`
      }}
      aria-label={`Resilience score ${value} out of 100`}
    >
      <div className="score-gauge__inner">
        <strong>{value}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton-stack" aria-label="Loading campaign">
      <div className="skeleton skeleton--wide" />
      <div className="skeleton" />
      <div className="skeleton skeleton--short" />
    </div>
  );
}

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [mode, setMode] = useState<ProtectionMode>("vulnerable");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("duplicate-after-timeout");
  const [source, setSource] = useState("");
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runCampaign = useCallback(async (
    nextMode: ProtectionMode,
    nextScenario: ScenarioId
  ) => {
    setRunning(true);
    setError(null);
    const started = Date.now();

    try {
      const [campaignResponse, sourceResponse] = await Promise.all([
        fetch("/api/campaigns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: nextMode, scenario: nextScenario })
        }),
        fetch(`/api/source/${nextScenario}/${nextMode}`)
      ]);

      if (!campaignResponse.ok || !sourceResponse.ok) {
        throw new Error("The campaign engine did not respond successfully.");
      }

      const nextReport = (await campaignResponse.json()) as CampaignReport;
      const nextSource = (await sourceResponse.json()) as { source: string };
      const remaining = Math.max(0, 650 - (Date.now() - started));
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
      setReport(nextReport);
      setSource(nextSource.source);
    } catch (campaignError) {
      setError(
        campaignError instanceof Error
          ? campaignError.message
          : "Unable to run the campaign."
      );
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const response = await fetch("/api/overview");
        if (!response.ok) throw new Error("Unable to load the target overview.");
        const payload = (await response.json()) as OverviewResponse;
        setOverview(payload);
        setSource(payload.source);
        await runCampaign("vulnerable", "duplicate-after-timeout");
      } catch (bootstrapError) {
        setError(
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Unable to connect to PayChaos."
        );
        setRunning(false);
      }
    }

    void bootstrap();
  }, [runCampaign]);

  const changeMode = (nextMode: ProtectionMode) => {
    if (nextMode === mode && report) return;
    setMode(nextMode);
    void runCampaign(nextMode, scenarioId);
  };

  const changeScenario = (nextScenario: ScenarioId) => {
    if (nextScenario === scenarioId && report) return;
    setScenarioId(nextScenario);
    void runCampaign(mode, nextScenario);
  };

  const lineNumbers = useMemo(
    () => source.split("\n").map((line, index) => ({ number: index + 1, line })),
    [source]
  );

  const selectedScenario = useMemo(
    () => overview?.scenarios.find((item) => item.scenario === scenarioId),
    [overview, scenarioId]
  );

  const failed = report?.status === "failed";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="PayChaos home">
          <span className="brand__mark"><Icon name="bolt" size={17} /></span>
          <span>PayChaos</span>
        </a>
        <nav className="topnav" aria-label="Page sections">
          <a className="active" href="#campaign">Campaign</a>
          <a href="#architecture">Architecture</a>
          <a href="#razorpay">Razorpay</a>
          <a href="#repository">Repository</a>
          <a href="#finding">Finding</a>
        </nav>
        <div className="target-pill">
          <span className="live-dot" />
          {overview?.target.name ?? "Connecting…"}
          <span className="target-pill__mode">
            {report?.execution.kind === "live-http" ? "LIVE HTTP" : "MODEL"}
          </span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <div className="eyebrow"><Icon name="spark" size={14} /> AUTONOMOUS RELIABILITY CAMPAIGN</div>
            <h1>Break payments<br /><span>before production does.</span></h1>
            <p>
              PayChaos understands your payment architecture, generates failure
              hypotheses, and proves the outcome with deterministic financial invariants.
            </p>
          </div>
          <div className="hero__actions">
            <button
              className="run-button"
              onClick={() => void runCampaign(mode, scenarioId)}
              disabled={running}
            >
              <span className={running ? "spin" : ""}><Icon name={running ? "spark" : "play"} /></span>
              {running ? "Attacking integration…" : "Run campaign"}
            </button>
            <span className="keyboard-hint">
              {selectedScenario?.id ?? "CHAOS"} · {report?.execution.kind === "live-http" ? "observed HTTP execution" : "deterministic replay"}
            </span>
          </div>
        </section>

        <section className="scenario-switcher" aria-label="Chaos scenario">
          <div className="scenario-switcher__intro">
            <span className="section-kicker">CAMPAIGN LIBRARY</span>
            <strong>Choose a failure hypothesis</strong>
          </div>
          <div className="scenario-options">
            {overview?.scenarios.map((scenario) => (
              <button
                className={scenario.scenario === scenarioId ? "active" : ""}
                key={scenario.scenario}
                onClick={() => changeScenario(scenario.scenario)}
              >
                <span>{scenario.id}</span>
                <strong>{scenario.name}</strong>
                <small>{scenarioCategory[scenario.scenario]}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="mode-bar" aria-label="Target implementation">
          <div className="mode-bar__label">
            <Icon name="branch" />
            Target implementation
          </div>
          <div className="segmented-control">
            <button
              className={mode === "vulnerable" ? "active danger" : ""}
              onClick={() => changeMode("vulnerable")}
            >
              <span /> Vulnerable baseline
            </button>
            <button
              className={mode === "protected" ? "active safe" : ""}
              onClick={() => changeMode("protected")}
            >
              <span /> Protected fix
            </button>
          </div>
          <div className="stack-label">{overview?.target.stack}</div>
        </section>

        {error ? (
          <div className="error-banner">
            <strong>Campaign unavailable</strong>
            <span>{error}</span>
            <button onClick={() => void runCampaign(mode, scenarioId)}>Try again</button>
          </div>
        ) : null}

        <section className="metric-grid" aria-label="Campaign summary">
          <article className="metric-card score-card">
            {running || !report ? <Skeleton /> : (
              <>
                <ScoreGauge value={report.resilienceScore} />
                <div>
                  <span className="metric-label">Resilience score</span>
                  <strong>{failed ? "Unsafe to ship" : "Ready for replay"}</strong>
                  <small>{failed ? "Critical invariant violated" : "All tested invariants held"}</small>
                </div>
              </>
            )}
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Icon name="target" /></span>
            <div>
              <span className="metric-label">Hypothesis confidence</span>
              <strong>{report ? `${Math.round(report.hypothesis.confidence * 100)}%` : "—"}</strong>
              <small>Code-grounded evidence</small>
            </div>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Icon name="shield" /></span>
            <div>
              <span className="metric-label">Financial invariants</span>
              <strong>{report ? `${report.invariants.filter((item) => item.passed).length} / ${report.invariants.length}` : "—"}</strong>
              <small>{failed ? "1 deterministic failure" : "All checks passed"}</small>
            </div>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Icon name="clock" /></span>
            <div>
              <span className="metric-label">Virtual campaign time</span>
              <strong>{report ? `${(report.durationMs / 1000).toFixed(2)}s` : "—"}</strong>
              <small>
                {report?.execution.kind === "live-http"
                  ? `${report.execution.requests} HTTP deliveries · ${report.execution.stateReads} state read`
                  : "Exact replay available"}
              </small>
            </div>
          </article>
        </section>

        <section className="content-grid" id="campaign">
          <article className="panel timeline-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">EXECUTION TRACE</span>
                <h2>Incident timeline</h2>
              </div>
              {report ? (
                <span className={`status-badge ${failed ? "failed" : "passed"}`}>
                  <span /> {failed ? "INVARIANT FAILED" : "INVARIANT PASSED"}
                </span>
              ) : null}
            </div>
            {running || !report ? <Skeleton /> : (
              <div className="timeline">
                {report.timeline.map((item, index) => (
                  <div className={`timeline-item ${item.tone}`} key={item.id}>
                    <div className="timeline-rail">
                      <span className="timeline-dot">{index + 1}</span>
                      {index < report.timeline.length - 1 ? <span className="timeline-line" /> : null}
                    </div>
                    <div className="timeline-copy">
                      <div className="timeline-meta">
                        <span>{kindLabel[item.kind]}</span>
                        <time>+{(item.offsetMs / 1000).toFixed(2)}s</time>
                      </div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      {item.data ? (
                        <div className="data-chips">
                          {Object.entries(item.data).slice(0, 2).map(([key, value]) => (
                            <span key={key}>{key}: <b>{String(value)}</b></span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <aside className="side-stack">
            <article className="panel scenario-panel">
              <span className="section-kicker">FAULT PLAN</span>
              <h2>{selectedScenario?.name ?? "Loading scenario…"}</h2>
              <p>{selectedScenario?.description}</p>
              <div className="fault-chain">
                {selectedScenario?.operators.map((operator, index) => (
                  <div key={operator}>
                    <span className={index === 2 ? "fault-hot" : ""}>{operator}</span>
                    {index < selectedScenario.operators.length - 1 ? <Icon name="arrow" size={14} /> : null}
                  </div>
                ))}
              </div>
              <div className="invariant-box">
                <span>FINANCIAL INVARIANT</span>
                <code>{report?.hypothesis.invariant ?? "count(fulfilments) <= 1"}</code>
              </div>
            </article>

            <article className="panel verdict-panel">
              <span className="section-kicker">DETERMINISTIC ORACLE</span>
              <div className="verdict-row">
                <div>
                  <span>Expected</span>
                  <strong>{report?.invariants[0].expected ?? "—"}</strong>
                </div>
                <div className="verdict-arrow"><Icon name="arrow" /></div>
                <div>
                  <span>Observed</span>
                  <strong className={failed ? "text-danger" : "text-success"}>
                    {report?.invariants[0].observed ?? "—"}
                  </strong>
                </div>
              </div>
              <p>
                The AI formed the hypothesis. This result came from observed database state,
                not an LLM judgment.
              </p>
            </article>
          </aside>
        </section>

        <section className="panel architecture-panel" id="architecture">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">CODE UNDERSTANDING</span>
              <h2>Discovered payment architecture</h2>
            </div>
            <span className="confidence">
              <Icon name="spark" size={14} />
              {report ? Math.round(report.architecture.confidence * 100) : "—"}% confidence
            </span>
          </div>
          {running || !report ? <Skeleton /> : (
            <div className="architecture-flow">
              {report.architecture.nodes.map((node, index) => (
                <div className="architecture-step" key={node.id}>
                  <div className={`architecture-node ${node.risk ? "risk" : ""}`}>
                    <span className="node-icon"><Icon name={node.kind === "database" ? "db" : node.kind === "logic" ? "code" : "bolt"} /></span>
                    <div>
                      <strong>{node.label}</strong>
                      <small>{node.detail}</small>
                    </div>
                    {node.risk ? <span className="risk-chip">RISK</span> : null}
                  </div>
                  {index < report.architecture.nodes.length - 1 ? (
                    <div className="flow-arrow"><span /><Icon name="arrow" size={16} /></div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="evidence-strip">
            <Icon name="code" />
            <div>
              <span>Evidence</span>
              <code>{report?.architecture.evidence.file}:{report?.architecture.evidence.line}</code>
            </div>
            <strong>{report?.architecture.evidence.excerpt}</strong>
          </div>
        </section>

        {report ? (
          <section className={`finding ${failed ? "finding--critical" : "finding--safe"}`} id="finding">
            <div className="finding__severity">
              <span>{failed ? "CRITICAL FINDING" : "VERIFIED CONTROL"}</span>
              <div className="finding__symbol">{failed ? "!" : <Icon name="check" size={28} />}</div>
            </div>
            <div className="finding__body">
              <span className="section-kicker">{failed ? "WHAT BROKE" : "CAMPAIGN RESULT"}</span>
              <h2>{report.finding.title}</h2>
              <p>{report.finding.whatBroke}</p>
              <div className="finding-facts">
                <div>
                  <span>WHY</span>
                  <p>{report.finding.whyItBroke}</p>
                </div>
                <div>
                  <span>WHERE</span>
                  <p><code>{report.finding.whereItBroke}</code></p>
                </div>
                <div>
                  <span>IMPACT</span>
                  <p>{report.finding.financialImpact}</p>
                </div>
              </div>
              <div className="fix-callout">
                <span className="fix-icon"><Icon name="shield" /></span>
                <div>
                  <span>RECOMMENDED CONTROL</span>
                  <p>{report.finding.suggestedFix}</p>
                </div>
                {failed ? (
                  <button onClick={() => changeMode("protected")}>
                    Verify fix <Icon name="arrow" size={15} />
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section className="lower-grid">
          <article className="panel evidence-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">
                  {report?.execution.kind === "live-http" ? "LIVE TARGET EVIDENCE" : "DATABASE EVIDENCE"}
                </span>
                <h2>{report?.evidenceTable.title ?? "Observed records"}</h2>
              </div>
              <span className="record-count">{report?.evidenceTable.rows.length ?? 0} rows</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {report?.evidenceTable.columns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report?.evidenceTable.rows.map((row) => (
                    <tr className={row._tone === "danger" ? "duplicate-row" : row._tone === "success" ? "safe-row" : ""} key={String(row._id)}>
                      {report.evidenceTable.columns.map((column, columnIndex) => (
                        <td key={column.key}>
                          {columnIndex < report.evidenceTable.columns.length - 1 ? (
                            <code>{String(row[column.key])}</code>
                          ) : String(row[column.key])}
                          {columnIndex === 0 && row._badge ? (
                            <span className={`duplicate-tag ${row._tone === "success" ? "safe" : ""}`}>
                              {String(row._badge)}
                            </span>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel source-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">SOURCE EVIDENCE</span>
                <h2>razorpay-webhook.ts</h2>
              </div>
              <span className={`source-state ${mode}`}>{mode}</span>
            </div>
            <div className="code-window">
              {lineNumbers.map(({ number, line }) => (
                <div
                  className={
                    line.includes("fulfilment.create") ||
                    line.includes("eventId has a UNIQUE") ||
                    line.includes("findFirst") ||
                    line.includes("outbox.create") ||
                    line.includes("queueShipment") ||
                    line.includes("payment.update")
                      ? `code-line highlight-${mode}`
                      : "code-line"
                  }
                  key={number}
                >
                  <span>{number}</span><code>{line || " "}</code>
                </div>
              ))}
            </div>
          </article>
        </section>

        <RazorpayPanel />

        <RepositoryPanel
          onRunScenario={(scenario) => {
            setMode("vulnerable");
            setScenarioId(scenario);
            void runCampaign("vulnerable", scenario);
            window.location.hash = "campaign";
          }}
        />
      </main>

      <footer>
        <a href="#top" className="brand">
          <span className="brand__mark"><Icon name="bolt" size={15} /></span>
          <span>PayChaos</span>
        </a>
        <p>We don&apos;t test whether your payment integration works. We test whether it survives.</p>
        <span>ENGINE v0.1 · LOCAL DEMO</span>
      </footer>
    </div>
  );
}
