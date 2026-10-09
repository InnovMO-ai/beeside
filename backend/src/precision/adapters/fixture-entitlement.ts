import { IntegrationDescriptor } from "../ports/integration-descriptor";
import { EntitlementProvider, EntitlementState } from "../ports/entitlement";

/**
 * Entitlement provider for controlled synthetic projects. It answers from configuration only —
 * it grants nothing by itself and contains no product logic: Precision applies the same rules to its
 * answer as to the answer of the real Core-backed provider.
 */
export class FixtureEntitlementProvider implements EntitlementProvider {
  private readonly states = new Map<string, EntitlementState>();
  private fallback: ((projectId: string) => Promise<EntitlementState | null>) | null = null;

  constructor(states: EntitlementState[] = []) {
    for (const s of states) this.states.set(s.projectId, s);
  }

  set(state: EntitlementState): void {
    this.states.set(state.projectId, state);
  }

  /** Resolves projects that were registered after start-up (configuration lookup on a miss). Explicit `set` always wins. */
  setFallback(resolve: (projectId: string) => Promise<EntitlementState | null>): void {
    this.fallback = resolve;
  }

  describe(): IntegrationDescriptor {
    return {
      port: "entitlement",
      implementation: "fixture",
      mode: "SIMULATED",
      verification: "NOT_VERIFIED",
      note: "Premium state supplied by configuration for synthetic projects.",
    };
  }

  async get(projectId: string): Promise<EntitlementState> {
    const known = this.states.get(projectId);
    if (known) return known;
    const resolved = this.fallback ? await this.fallback(projectId) : null;
    if (resolved) { this.states.set(projectId, resolved); return resolved; }
    return { projectId, premiumActive: false, accessMode: "REVOKED" };
  }
}
