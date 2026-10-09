/**
 * Provider selection by environment: `PRECISION_MODEL_PROVIDER=gateway|scripted` (default `scripted`, so a
 * missing variable can never reach a real model). The gateway provider reads its credentials from the process
 * environment only, at call time; nothing here reads or prints a key.
 */
import type { GatewayDeps } from "../../engine/gateway";
import type { ModelProvider } from "../ports";
import { GatewayModelProvider } from "./gateway-model";
import { ScriptedModelProvider, type ScriptedFixture } from "./scripted-model";

export type ProviderName = "gateway" | "scripted";

export function providerNameFromEnv(env: Record<string, string | undefined> = process.env): ProviderName {
  return env.PRECISION_MODEL_PROVIDER === "gateway" ? "gateway" : "scripted";
}

export interface SelectOptions {
  env?: Record<string, string | undefined>;
  fixture?: ScriptedFixture;
  gatewayDeps?: GatewayDeps;
}

export function selectModelProvider(options: SelectOptions = {}): ModelProvider {
  const env = options.env ?? process.env;
  if (providerNameFromEnv(env) === "gateway") return new GatewayModelProvider({ env, ...(options.gatewayDeps ? { deps: options.gatewayDeps } : {}) });
  return new ScriptedModelProvider(options.fixture ? { fixture: options.fixture } : {});
}
