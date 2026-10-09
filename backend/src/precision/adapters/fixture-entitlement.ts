import { IntegrationDescriptor } from "../ports/integration-descriptor";
import { EntitlementProvider, EntitlementState } from "../ports/entitlement";

/**
 * Entitlement provider for controlled synthetic projects. It answers from configuration only —
 * it grants nothing by itself and contains no product logic: Precision applies the same rules to its
 * answer as to the answer of the real Core-backed provider.
 */
export class FixtureEntitlementProvider implements EntitlementProvider {
  private readonly states = new Map<string, EntitlementState>();

  constructor(states: EntitlementState[] = []) {
    for (const s of states) this.states.set(s.projectId, s);
  }

  set(state: EntitlementState): void {
    this.states.set(state.projectId, state);
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
    return this.states.get(projectId) ?? { projectId, premiumActive: false, accessMode: "REVOKED" };
  }
}
