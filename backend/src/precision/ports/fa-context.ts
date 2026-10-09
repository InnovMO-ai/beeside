import { Described } from "./integration-descriptor";

/**
 * FaContextReader — Precision's read of the First Assessment context (pull by project_id).
 * It returns only the `client_safe` projection: no e-mail value, no rendered Expansion View, no
 * tokens, no payment data. Free-text fields are untrusted client input.
 */
export interface FaClientSafeContext {
  project: {
    destinationCountry: string;
    destinationMarket?: string;
    sector: string;
    expansionObjective: string;
    timeframe?: string;
  };
  company: { displayName: string; sizeBand?: string; operatingCountries: string[] };
  /** Capability / service identifiers FA determined the project needs, with the client's priority. */
  needs: { capabilityId: string; label: string; priority: "high" | "medium" | "low"; status?: string }[];
  /** Untrusted literals (guarded before reaching the model). */
  literals: { motive?: string; context?: string };
  locale: "es" | "en";
}

export interface FaContextRead {
  sourceSystem: "fa4";
  sourceProjectId: string;
  sourceResultId: string;
  catalogVersion: string;
  contractVersion: string;
  crosswalkVersion: string;
  /** Hash of the canonical context (detects divergence on return; never used to rebuild it). */
  contextHash: string;
  deliveredAt: string;
  context: FaClientSafeContext;
}

export interface FaContextReader extends Described {
  /** Resolves with the delivered result for the project, or null when none is delivered yet. */
  read(projectId: string): Promise<FaContextRead | null>;
}
