import { CoreEntitlementProvider } from "./core-entitlement";
import { accessPermits } from "../ports/entitlement";
import { Db } from "../../db/database";

const D = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00Z");

/** A Db stub that answers the single entitlement+subscription query with a prepared row (or none). */
function dbReturning(row: Record<string, unknown> | null): Pick<Db, "query"> & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    query: (async (text: string) => {
      queries.push(text);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }) as Db["query"],
  };
}

describe("CoreEntitlementProvider", () => {
  const policy = { readonlyGraceDays: 90 };

  it("describes itself as REAL / NOT_VERIFIED (sandbox not verified yet)", () => {
    const d = new CoreEntitlementProvider(dbReturning(null), { policy }).describe();
    expect(d).toMatchObject({ port: "entitlement", implementation: "core", mode: "REAL", verification: "NOT_VERIFIED" });
  });

  it("unknown project -> REVOKED, not premium", async () => {
    const p = new CoreEntitlementProvider(dbReturning(null), { policy, now: () => NOW });
    expect(await p.get("p1")).toEqual({ projectId: "p1", premiumActive: false, accessMode: "REVOKED" });
  });

  it("active Premium -> FULL and permits writes", async () => {
    const db = dbReturning({ premium_access_active: true, precision_access_mode: "FULL", premium_ended_at: null, readonly_until: null, subscription_status: "PREMIUM_ACTIVE", subscription_period_end: new Date(NOW.getTime() + D) });
    const s = await new CoreEntitlementProvider(db, { policy, now: () => NOW }).get("p1");
    expect(s).toEqual({ projectId: "p1", premiumActive: true, accessMode: "FULL" });
    expect(accessPermits(s.accessMode, "write")).toBe(true);
  });

  it("ended Premium -> READ_ONLY with readonlyUntil: reads allowed, writes refused", async () => {
    const ended = new Date(NOW.getTime() - 10 * D);
    const db = dbReturning({ premium_access_active: false, precision_access_mode: "READ_ONLY", premium_ended_at: ended, readonly_until: new Date(ended.getTime() + 90 * D), subscription_status: "PREMIUM_INACTIVE", subscription_period_end: ended });
    const s = await new CoreEntitlementProvider(db, { policy, now: () => NOW }).get("p1");
    expect(s).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY", readonlyUntil: new Date(ended.getTime() + 90 * D).toISOString() });
    expect(accessPermits(s.accessMode, "read")).toBe(true);
    expect(accessPermits(s.accessMode, "write")).toBe(false);
  });

  it("reads Core tables only: the single query touches entitlement and subscription and nothing named stripe", async () => {
    const db = dbReturning(null);
    await new CoreEntitlementProvider(db, { policy }).get("p1");
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toMatch(/FROM entitlement/);
    expect(db.queries[0]).not.toMatch(/stripe|premium_checkout/i);
  });
});
