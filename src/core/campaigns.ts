import { runDuplicateAfterTimeoutCampaign } from "./engine.js";
import { runOutOfOrderCampaign } from "./stateEngine.js";
import type { CampaignReport, ProtectionMode, ScenarioId } from "./types.js";

export function runCampaign(
  scenario: ScenarioId,
  mode: ProtectionMode
): CampaignReport {
  return scenario === "out-of-order-regression"
    ? runOutOfOrderCampaign(mode)
    : runDuplicateAfterTimeoutCampaign(mode);
}
