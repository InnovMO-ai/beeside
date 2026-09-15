import { Logger } from "../security/redact";
import { integrationMode } from "../security/runtime-config";
import { CaptureOperationHubAdapter } from "./operation-hub";
import { CaptureSmartSuiteClient, HttpSmartSuiteClient, SmartSuiteAdapter, SmartSuiteMapping, developmentCaptureMapping, validateSmartSuiteMapping } from "./smartsuite";
import { IntegrationSet } from "./types";

export const SMARTSUITE_DEFAULT_API_BASE_URL = "https://app.smartsuite.com/api/v1";

/**
 * Builds the enabled destination adapters from the environment. Every destination is disabled by
 * default; development may capture; production refuses capture and any live destination without
 * its full configuration. Credentials and the mapping come from the secrets store, never from code.
 */
export function integrationsFromEnv(env: NodeJS.ProcessEnv, log?: Logger): IntegrationSet {
  const production = env.NODE_ENV === "production";
  const adapters: IntegrationSet["adapters"] = {};

  const smartsuite = integrationMode(env.INTEGRATION_SMARTSUITE_MODE);
  if (smartsuite !== "disabled") {
    let mapping: SmartSuiteMapping | null = null;
    if (env.SMARTSUITE_MAPPING_JSON) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(env.SMARTSUITE_MAPPING_JSON);
      } catch {
        throw new Error("SMARTSUITE_MAPPING_JSON is not valid JSON");
      }
      const result = validateSmartSuiteMapping(parsed);
      if (!result.mapping) throw new Error(`SMARTSUITE_MAPPING_JSON is invalid: ${result.errors.join("; ")}`);
      mapping = result.mapping;
    }
    if (smartsuite === "live") {
      const missing = ["SMARTSUITE_MAPPING_JSON", "SMARTSUITE_API_TOKEN", "SMARTSUITE_ACCOUNT_ID"].filter((name) => !env[name]);
      if (missing.length > 0 || !mapping) throw new Error(`INTEGRATION_SMARTSUITE_MODE=live requires ${missing.join(", ")}`);
      const baseUrl = env.SMARTSUITE_API_BASE_URL ?? SMARTSUITE_DEFAULT_API_BASE_URL;
      if (!baseUrl.startsWith("https://")) throw new Error("SMARTSUITE_API_BASE_URL must use https");
      adapters.smartsuite = new SmartSuiteAdapter(
        mapping,
        new HttpSmartSuiteClient({ apiToken: env.SMARTSUITE_API_TOKEN as string, accountId: env.SMARTSUITE_ACCOUNT_ID as string, baseUrl }),
        "live",
      );
    } else {
      if (production) throw new Error("INTEGRATION_SMARTSUITE_MODE=capture is not allowed in production");
      adapters.smartsuite = new SmartSuiteAdapter(mapping ?? developmentCaptureMapping(), new CaptureSmartSuiteClient(log), "capture");
    }
  }

  const operationHub = integrationMode(env.INTEGRATION_OPERATION_HUB_MODE);
  if (operationHub === "live") {
    throw new Error("INTEGRATION_OPERATION_HUB_MODE=live is not available: no Operation Hub workspace contract or credentials are defined");
  }
  if (operationHub === "capture") {
    if (production) throw new Error("INTEGRATION_OPERATION_HUB_MODE=capture is not allowed in production");
    adapters.operation_hub = new CaptureOperationHubAdapter(log);
  }
  return { adapters };
}
