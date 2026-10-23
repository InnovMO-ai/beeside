import { IntegrationDescriptor } from "./integration-descriptor";
import { EntitlementProvider } from "./entitlement";
import { FaContextReader } from "./fa-context";
import { OperationHubPort } from "./operation-hub";

/**
 * The set of external-system implementations a Precision process runs with. Which implementation is
 * active is a deployment configuration decision; product behaviour never branches on it.
 */
export interface PrecisionIntegrations {
  operationHub: OperationHubPort;
  entitlement: EntitlementProvider;
  faContext: FaContextReader;
}

export interface IntegrationStatusReport {
  /** Internal review surface only. */
  integrations: IntegrationDescriptor[];
  /** True when every integration is REAL and at least VERIFIED. */
  allReal: boolean;
}

export function integrationStatus(i: PrecisionIntegrations): IntegrationStatusReport {
  const integrations = [i.operationHub.describe(), i.entitlement.describe(), i.faContext.describe()];
  return { integrations, allReal: integrations.every((d) => d.mode === "REAL" && d.verification !== "NOT_VERIFIED") };
}

export type OperationHubProviderName = "simulator" | "clickup";
export type EntitlementProviderName = "fixture" | "core";
export type FaContextProviderName = "fixture" | "discovery" | "reader";

export interface IntegrationSelection {
  operationHub: OperationHubProviderName;
  entitlement: EntitlementProviderName;
  faContext: FaContextProviderName;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  if (raw === undefined || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${name} must be one of ${allowed.join(", ")} (got "${raw}")`);
}

/** Reads the provider selection from the environment. Defaults are the isolated (non-external) providers. */
export function selectionFromEnv(env: NodeJS.ProcessEnv = process.env): IntegrationSelection {
  return {
    operationHub: pick(env.PRECISION_OH_PROVIDER, ["simulator", "clickup"] as const, "simulator", "PRECISION_OH_PROVIDER"),
    entitlement: pick(env.PRECISION_ENTITLEMENT_PROVIDER, ["fixture", "core"] as const, "fixture", "PRECISION_ENTITLEMENT_PROVIDER"),
    faContext: pick(env.PRECISION_FA_CONTEXT_PROVIDER, ["fixture", "discovery", "reader"] as const, "fixture", "PRECISION_FA_CONTEXT_PROVIDER"),
  };
}
