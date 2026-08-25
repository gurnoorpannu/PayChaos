import { randomUUID } from "node:crypto";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const DIAGNOSTIC_AMOUNT = 500;
const DIAGNOSTIC_CURRENCY = "INR";
const REQUEST_TIMEOUT_MS = 15_000;

interface Environment {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
}

interface RazorpayOrderResponse {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  receipt?: unknown;
  created_at?: unknown;
}

export interface RazorpayConnectorStatus {
  provider: "razorpay";
  mode: "test" | "unconfigured" | "rejected";
  configured: boolean;
  testMode: boolean;
  keyIdHint?: string;
  message: string;
}

export interface RazorpayDiagnosticOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
  createdAt: string;
  source: "razorpay-test-mode";
}

export interface RazorpayDiagnosticResult {
  order: RazorpayDiagnosticOrder;
  roundTripVerified: true;
  createRequestId?: string;
  fetchRequestId?: string;
  fetchedAt: string;
}

export class RazorpayConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "live_key_rejected" | "request_failed" | "invalid_response",
    public readonly status: number
  ) {
    super(message);
    this.name = "RazorpayConnectorError";
  }
}

function configuredCredentials(environment: Environment) {
  const keyId = environment.RAZORPAY_KEY_ID?.trim();
  const keySecret = environment.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    throw new RazorpayConnectorError(
      "Add both Razorpay Test Mode credentials before creating a diagnostic order.",
      "not_configured",
      409
    );
  }

  if (!keyId.startsWith("rzp_test_")) {
    throw new RazorpayConnectorError(
      "PayChaos rejected this key because only Razorpay Test Mode credentials are allowed.",
      "live_key_rejected",
      400
    );
  }

  return { keyId, keySecret };
}

function maskKeyId(keyId: string): string {
  if (keyId.length < 9) return "rzp_test_••••";
  return `${keyId.slice(0, 9)}••••${keyId.slice(-4)}`;
}

export function getRazorpayConnectorStatus(
  environment: Environment = process.env
): RazorpayConnectorStatus {
  const keyId = environment.RAZORPAY_KEY_ID?.trim();
  const keySecret = environment.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    return {
      provider: "razorpay",
      mode: "unconfigured",
      configured: false,
      testMode: false,
      message: "Add Razorpay Test Mode credentials to enable diagnostic orders."
    };
  }

  if (!keyId.startsWith("rzp_test_")) {
    return {
      provider: "razorpay",
      mode: "rejected",
      configured: false,
      testMode: false,
      keyIdHint: maskKeyId(keyId),
      message: "Live or unrecognised credentials are blocked. Use an rzp_test_ key."
    };
  }

  return {
    provider: "razorpay",
    mode: "test",
    configured: true,
    testMode: true,
    keyIdHint: maskKeyId(keyId),
    message: "Razorpay Test Mode is ready. No live-money requests are permitted."
  };
}

function diagnosticReceipt(): string {
  return `paychaos_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

async function parseOrder(response: Response, operation: "create" | "fetch") {
  if (!response.ok) {
    throw new RazorpayConnectorError(
      `Razorpay Test Mode ${operation} request failed with HTTP ${response.status}.`,
      "request_failed",
      502
    );
  }

  let payload: RazorpayOrderResponse;
  try {
    payload = (await response.json()) as RazorpayOrderResponse;
  } catch {
    throw new RazorpayConnectorError(
      `Razorpay returned an unreadable ${operation} response.`,
      "invalid_response",
      502
    );
  }

  if (
    typeof payload.id !== "string" ||
    typeof payload.amount !== "number" ||
    typeof payload.currency !== "string" ||
    typeof payload.status !== "string" ||
    typeof payload.receipt !== "string" ||
    typeof payload.created_at !== "number"
  ) {
    throw new RazorpayConnectorError(
      `Razorpay returned an incomplete ${operation} response.`,
      "invalid_response",
      502
    );
  }

  return payload as Required<RazorpayOrderResponse>;
}

function requestId(response: Response): string | undefined {
  return response.headers.get("x-razorpay-request-id") ?? undefined;
}

export async function createRazorpayDiagnosticOrder(
  environment: Environment = process.env,
  request: typeof fetch = fetch
): Promise<RazorpayDiagnosticResult> {
  const { keyId, keySecret } = configuredCredentials(environment);
  const authorization = Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64");
  const receipt = diagnosticReceipt();
  const createResponse = await request(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      authorization: `Basic ${authorization}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      amount: DIAGNOSTIC_AMOUNT,
      currency: DIAGNOSTIC_CURRENCY,
      receipt,
      partial_payment: false,
      notes: {
        purpose: "paychaos_diagnostic",
        environment: "test_only"
      }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const created = await parseOrder(createResponse, "create");

  const fetchResponse = await request(
    `${RAZORPAY_API_BASE}/orders/${encodeURIComponent(created.id as string)}`,
    {
      method: "GET",
      headers: { authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  );
  const fetched = await parseOrder(fetchResponse, "fetch");

  if (
    fetched.id !== created.id ||
    fetched.amount !== DIAGNOSTIC_AMOUNT ||
    fetched.currency !== DIAGNOSTIC_CURRENCY ||
    fetched.receipt !== receipt
  ) {
    throw new RazorpayConnectorError(
      "The fetched test order did not match the order PayChaos created.",
      "invalid_response",
      502
    );
  }

  return {
    order: {
      id: fetched.id as string,
      amount: fetched.amount as number,
      currency: fetched.currency as string,
      status: fetched.status as string,
      receipt: fetched.receipt as string,
      createdAt: new Date((fetched.created_at as number) * 1_000).toISOString(),
      source: "razorpay-test-mode"
    },
    roundTripVerified: true,
    createRequestId: requestId(createResponse),
    fetchRequestId: requestId(fetchResponse),
    fetchedAt: new Date().toISOString()
  };
}
