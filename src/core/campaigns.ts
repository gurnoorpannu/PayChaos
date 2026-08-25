import { runDuplicateAfterTimeoutCampaign } from "./engine.js";
import { runCrashRecoveryCampaign } from "./crashEngine.js";
import { runOutOfOrderCampaign } from "./stateEngine.js";
import type { CampaignReport, ProtectionMode, ScenarioId } from "./types.js";

export function runCampaign(
  scenario: ScenarioId,
  mode: ProtectionMode
): CampaignReport {
  if (scenario === "out-of-order-regression") return runOutOfOrderCampaign(mode);
  if (scenario === "crash-before-side-effect") return runCrashRecoveryCampaign(mode);
  return runDuplicateAfterTimeoutCampaign(mode);
}
