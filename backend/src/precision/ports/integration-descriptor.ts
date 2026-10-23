/**
 * Internal-only description of an external integration. Never shown to a client: the customer-facing
 * product renders the same states whichever implementation is active. The internal review surface
 * reads these descriptors so it is always clear what is simulated and what is real.
 */
export type IntegrationMode = "SIMULATED" | "SANDBOX" | "REAL";
export type IntegrationVerification = "NOT_VERIFIED" | "VERIFIED" | "PRODUCTION_READY";

export interface IntegrationDescriptor {
  /** Port name, e.g. "operation_hub". */
  readonly port: "operation_hub" | "entitlement" | "fa_context";
  /** Implementation name, e.g. "simulator", "clickup", "fixture", "core", "stripe". */
  readonly implementation: string;
  readonly mode: IntegrationMode;
  readonly verification: IntegrationVerification;
  /** Human-readable note for the internal review surface. */
  readonly note?: string;
}

export interface Described {
  describe(): IntegrationDescriptor;
}
