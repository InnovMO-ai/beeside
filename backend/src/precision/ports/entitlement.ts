import { Described } from "./integration-descriptor";

/**
 * EntitlementProvider — Precision's view of Premium access. Core owns the state; Stripe (or any
 * payment platform) reaches Precision only through Core. Precision never reads a payment platform
 * and never trusts a browser redirect.
 */
export type PrecisionAccessMode = "FULL" | "READ_ONLY" | "REVOKED";

export interface EntitlementState {
  projectId: string;
  premiumActive: boolean;
  accessMode: PrecisionAccessMode;
  /** When the read-only window ends (REVOKED afterwards). */
  readonlyUntil?: string;
}

export interface EntitlementProvider extends Described {
  get(projectId: string): Promise<EntitlementState>;
}

/** Which operations an access mode permits (contract §G). */
export function accessPermits(mode: PrecisionAccessMode, operation: "read" | "write"): boolean {
  if (mode === "FULL") return true;
  if (mode === "READ_ONLY") return operation === "read";
  return false;
}
