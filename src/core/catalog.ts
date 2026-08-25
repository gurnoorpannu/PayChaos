import {
  protectedConcurrencySource,
  protectedCrashSource,
  protectedMerchantSource,
  protectedSignatureSource,
  protectedStateSource,
  vulnerableConcurrencySource,
  vulnerableCrashSource,
  vulnerableMerchantSource,
  vulnerableSignatureSource,
  vulnerableStateSource
} from "./sample.js";
import type {
  OverviewResponse,
  ProtectionMode,
  ScenarioId
} from "./types.js";

export function sourceForScenario(scenario: ScenarioId, mode: ProtectionMode): string {
  const protectedMode = mode === "protected";
  switch (scenario) {
    case "out-of-order-regression":
      return protectedMode ? protectedStateSource : vulnerableStateSource;
    case "crash-before-side-effect":
      return protectedMode ? protectedCrashSource : vulnerableCrashSource;
    case "concurrent-delivery-race":
      return protectedMode ? protectedConcurrencySource : vulnerableConcurrencySource;
    case "forged-webhook":
      return protectedMode ? protectedSignatureSource : vulnerableSignatureSource;
    default:
      return protectedMode ? protectedMerchantSource : vulnerableMerchantSource;
  }
}

export function getOverview(): OverviewResponse {
  return {
    target: {
      name: "Acme Store",
      environment: "Razorpay Test Mode",
      stack: "Express · Live HTTP · Instrumented store"
    },
    scenarios: [
      {
        id: "CHAOS-001",
        scenario: "duplicate-after-timeout",
        name: "Duplicate after post-commit timeout",
        description:
          "Lose the webhook acknowledgement after the merchant commits, then redeliver the identical Razorpay event.",
        operators: ["Deliver", "Commit", "Timeout", "Retry"]
      },
      {
        id: "CHAOS-002",
        scenario: "out-of-order-regression",
        name: "Out-of-order state regression",
        description:
          "Deliver capture first, then release an older delayed failure for the same payment.",
        operators: ["Capture", "Delay", "Stale failure", "Inspect"]
      },
      {
        id: "CHAOS-003",
        scenario: "crash-before-side-effect",
        name: "Crash before external side effect",
        description:
          "Crash after payment state commits but before shipment dispatch, then restart and replay delivery.",
        operators: ["Commit", "Crash", "Restart", "Recover"]
      },
      {
        id: "CHAOS-004",
        scenario: "concurrent-delivery-race",
        name: "Concurrent idempotency race",
        description:
          "Release the same captured event to two workers together, pausing both after their idempotency read.",
        operators: ["Fork", "Read", "Race", "Inspect"]
      },
      {
        id: "CHAOS-005",
        scenario: "forged-webhook",
        name: "Forged webhook boundary",
        description:
          "Sign a valid capture, mutate its raw payment amount, then deliver the forged bytes with the stale signature.",
        operators: ["Sign", "Tamper", "Deliver", "Inspect"]
      }
    ],
    source: vulnerableMerchantSource
  };
}
