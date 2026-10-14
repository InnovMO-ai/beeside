import { Db } from "../../db/database";
import { PremiumPolicy } from "../../premium/premium-policy";
import { deriveAccess, loadAccessRow } from "../../premium/precision-access";
import { EntitlementProvider, EntitlementState } from "../ports/entitlement";
import { IntegrationDescriptor } from "../ports/integration-descriptor";

/**
 * EntitlementProvider backed by Core (selected with PRECISION_ENTITLEMENT_PROVIDER=core). It reads Core tables only
 * (entitlement, subscription): it never calls Stripe and never looks at a browser redirect. Only a verified payment
 * that Core applied (webhook or reconciliation) can have made a project FULL; the clock then decides when that ends.
 * A project Core has no record of is REVOKED (no Premium, nothing to read), the same answer the fixture gives.
 */
export class CoreEntitlementProvider implements EntitlementProvider {
  constructor(
    private readonly db: Pick<Db, "query">,
    private readonly options: { policy: Pick<PremiumPolicy, "readonlyGraceDays"> & Partial<Pick<PremiumPolicy, "renewalSafetyDays">>; now?: () => Date },
  ) {}

  describe(): IntegrationDescriptor {
    return {
      port: "entitlement",
      implementation: "core",
      mode: "REAL",
      verification: "NOT_VERIFIED",
      note: "Reads Core entitlement/subscription state. Payment confirmation by Stripe is contract-tested against a fake only; sandbox not verified.",
    };
  }

  async get(projectId: string): Promise<EntitlementState> {
    const now = (this.options.now ?? (() => new Date()))();
    const row = await loadAccessRow(this.db as Db, projectId);
    const access = deriveAccess(row, now, this.options.policy);
    return {
      projectId,
      premiumActive: access.mode === "FULL",
      accessMode: access.mode,
      ...(access.readonlyUntil ? { readonlyUntil: access.readonlyUntil.toISOString() } : {}),
    };
  }
}
