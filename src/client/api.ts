export const readOnlyDemo = import.meta.env.VITE_READ_ONLY_DEMO === "true";

function jsonError(error: string, status = 405): Response {
  return new Response(JSON.stringify({ error, readOnly: true }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function bodyValue(init: RequestInit | undefined, key: string): string | undefined {
  if (typeof init?.body !== "string") return undefined;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    return typeof body[key] === "string" ? body[key] as string : undefined;
  } catch {
    return undefined;
  }
}

function staticAsset(route: string, init?: RequestInit): string | undefined {
  if (route === "/api/overview") return "overview.json";
  if (route === "/api/intelligence/status") return "intelligence-status.json";
  if (route === "/api/razorpay/status") return "razorpay-status.json";
  if (route === "/api/sandbox/status") return "sandbox-status.json";

  if (route === "/api/campaigns") {
    const scenario = bodyValue(init, "scenario") ?? "duplicate-after-timeout";
    const mode = bodyValue(init, "mode") === "protected" ? "protected" : "vulnerable";
    return `campaign-${scenario}-${mode}.json`;
  }

  const source = route.match(/^\/api\/source\/([^/]+)\/(vulnerable|protected)$/);
  if (source) return `source-${source[1]}-${source[2]}.json`;

  const repository = route.match(/^\/api\/repositories\/demo\/([^/]+)$/);
  if (repository) return `repository-${repository[1]}.json`;

  const regression = route.match(/^\/api\/regressions\/([^/]+)$/);
  if (regression) return `regression-${regression[1]}.json`;

  const sandbox = route.match(/^\/api\/sandbox\/demo\/(vulnerable|protected)$/);
  if (sandbox) return `sandbox-${sandbox[1]}.json`;

  return undefined;
}

export function apiFetch(route: string, init?: RequestInit): Promise<Response> {
  if (!readOnlyDemo) return fetch(route, init);

  const asset = staticAsset(route, init);
  if (!asset) {
    return Promise.resolve(jsonError(
      "This action requires the local PayChaos API. The hosted demonstration is read-only."
    ));
  }
  return fetch(`${import.meta.env.BASE_URL}demo-api/${asset}`);
}
