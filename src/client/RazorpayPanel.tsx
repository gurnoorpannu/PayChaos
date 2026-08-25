import { useEffect, useState } from "react";
import type {
  RazorpayConnectorStatus,
  RazorpayDiagnosticResult
} from "../connectors/razorpayTestMode.js";
import { apiFetch } from "./api.js";

interface ErrorPayload {
  error?: string;
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency
  }).format(amount / 100);
}

export function RazorpayPanel() {
  const [status, setStatus] = useState<RazorpayConnectorStatus | null>(null);
  const [result, setResult] = useState<RazorpayDiagnosticResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/razorpay/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("Connector status is unavailable.");
        return response.json() as Promise<RazorpayConnectorStatus>;
      })
      .then(setStatus)
      .catch(() => {
        setStatus({
          provider: "razorpay",
          mode: "unconfigured",
          configured: false,
          testMode: false,
          message: "Connector status is unavailable."
        });
      });
  }, []);

  async function createTestOrder() {
    setCreating(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiFetch("/api/razorpay/test-order", { method: "POST" });
      const payload = (await response.json()) as RazorpayDiagnosticResult & ErrorPayload;
      if (!response.ok) throw new Error(payload.error ?? "Diagnostic order failed.");
      setResult(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Diagnostic order failed."
      );
    } finally {
      setCreating(false);
    }
  }

  const ready = status?.configured === true && status.testMode === true;

  return (
    <section className="panel razorpay-panel" id="razorpay">
      <div className="panel-heading razorpay-heading">
        <div>
          <span className="section-kicker">REAL PROVIDER BOUNDARY</span>
          <h2>Razorpay Test Mode connector</h2>
        </div>
        <div className={`razorpay-state ${status?.mode ?? "unconfigured"}`}>
          <span className="provider-dot" />
          <div>
            <strong>{ready ? "TEST MODE READY" : status?.mode === "rejected" ? "KEY REJECTED" : "SAFE LOCAL FALLBACK"}</strong>
            <small>{status?.keyIdHint ?? "credentials stay server-side"}</small>
          </div>
        </div>
      </div>

      <div className="razorpay-body">
        <div className="razorpay-copy">
          <p>{status?.message ?? "Checking the connector safety boundary…"}</p>
          <div className="connector-flow" aria-label="Diagnostic order verification flow">
            <span>CREATE ₹5 TEST ORDER</span><i>→</i><span>FETCH BY ID</span><i>→</i><span>VERIFY RECEIPT</span>
          </div>
          {!ready ? (
            <small>
              Set <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in <code>.env</code>. Only keys beginning with <code>rzp_test_</code> are accepted.
            </small>
          ) : null}
        </div>
        <button
          className="razorpay-order-button"
          disabled={!ready || creating}
          onClick={() => void createTestOrder()}
        >
          {creating ? "Creating and fetching…" : "Create ₹5 test order"}
        </button>
      </div>

      {error ? <div className="repository-error">{error}</div> : null}

      {result ? (
        <div className="razorpay-result" aria-live="polite">
          <div className="razorpay-proof">
            <span>ROUND TRIP</span>
            <strong>VERIFIED</strong>
            <small>Created and fetched from Razorpay</small>
          </div>
          <div><span>ORDER ID</span><code>{result.order.id}</code></div>
          <div><span>AMOUNT</span><strong>{money(result.order.amount, result.order.currency)}</strong></div>
          <div><span>STATUS</span><strong>{result.order.status.toUpperCase()}</strong></div>
          <div><span>RECEIPT</span><code>{result.order.receipt}</code></div>
        </div>
      ) : (
        <div className="razorpay-footnote">
          This action creates an order only. It cannot capture a payment, uses no checkout, and blocks live keys.
        </div>
      )}
    </section>
  );
}
