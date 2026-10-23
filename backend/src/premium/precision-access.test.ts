import { AccessRow, deriveAccess } from "./precision-access";

const D = 86_400_000;
const T0 = new Date("2026-01-01T00:00:00Z");
const grace = { readonlyGraceDays: 90 };

const full = (periodEnd: Date, status: AccessRow["subscription_status"] = "PREMIUM_ACTIVE"): AccessRow => ({
  premium_access_active: true, precision_access_mode: "FULL", premium_ended_at: null, readonly_until: null, subscription_status: status, subscription_period_end: periodEnd,
});

describe("deriveAccess (pure; the clock decides, the stored state never grants more)", () => {
  it("no Core record -> REVOKED", () => {
    expect(deriveAccess(null, T0, grace)).toEqual({ mode: "REVOKED", readonlyUntil: null });
  });

  it("FULL while the paid period runs, also while a cancellation is scheduled", () => {
    expect(deriveAccess(full(new Date(T0.getTime() + D)), T0, grace).mode).toBe("FULL");
    expect(deriveAccess(full(new Date(T0.getTime() + D), "CANCELLATION_SCHEDULED"), T0, grace).mode).toBe("FULL");
  });

  it("FULL stored but period ran out and the sweep is late -> READ_ONLY with the window derived from the configured days", () => {
    const end = new Date(T0.getTime() - D);
    const r = deriveAccess(full(end), T0, grace);
    expect(r.mode).toBe("READ_ONLY");
    expect(r.readonlyUntil?.getTime()).toBe(end.getTime() + 90 * D);
  });

  it("the window length is configuration, not a literal", () => {
    const end = new Date(T0.getTime() - D);
    expect(deriveAccess(full(end), T0, { readonlyGraceDays: 7 }).readonlyUntil?.getTime()).toBe(end.getTime() + 7 * D);
    expect(deriveAccess(full(end), T0, { readonlyGraceDays: 0 }).mode).toBe("REVOKED");
  });

  it("READ_ONLY uses the settled readonly_until over any configuration; REVOKED once it has elapsed", () => {
    const row: AccessRow = { premium_access_active: false, precision_access_mode: "READ_ONLY", premium_ended_at: new Date(T0.getTime() - 10 * D), readonly_until: new Date(T0.getTime() + 5 * D), subscription_status: "PREMIUM_INACTIVE", subscription_period_end: null };
    expect(deriveAccess(row, T0, { readonlyGraceDays: 1 }).mode).toBe("READ_ONLY");
    expect(deriveAccess(row, new Date(T0.getTime() + 5 * D), grace).mode).toBe("REVOKED");
  });

  it("stored REVOKED stays REVOKED; stored READ_ONLY without a window falls back to ended + configured days", () => {
    const revoked: AccessRow = { premium_access_active: false, precision_access_mode: "REVOKED", premium_ended_at: T0, readonly_until: T0, subscription_status: "PREMIUM_INACTIVE", subscription_period_end: null };
    expect(deriveAccess(revoked, T0, grace).mode).toBe("REVOKED");
    const unsettled: AccessRow = { ...revoked, precision_access_mode: "READ_ONLY", readonly_until: null };
    expect(deriveAccess(unsettled, new Date(T0.getTime() + 89 * D), grace).mode).toBe("READ_ONLY");
    expect(deriveAccess(unsettled, new Date(T0.getTime() + 90 * D), grace).mode).toBe("REVOKED");
  });
});

describe("deriveAccess with a dated source (grant): the clock closes it even if the source sync has not run", () => {
  const grantFull = (until: Date | null): AccessRow => ({
    premium_access_active: true, precision_access_mode: "FULL", premium_ended_at: null, readonly_until: null,
    subscription_status: null, subscription_period_end: null, effective_until: until,
  });

  it("FULL while the grant runs; open-ended entitlement (no date) stays FULL", () => {
    expect(deriveAccess(grantFull(new Date(T0.getTime() + D)), T0, grace).mode).toBe("FULL");
    expect(deriveAccess(grantFull(null), T0, grace).mode).toBe("FULL");
  });

  it("grant ran out and nothing synced -> READ_ONLY with the window from its date", () => {
    const end = new Date(T0.getTime() - D);
    const r = deriveAccess(grantFull(end), T0, grace);
    expect(r.mode).toBe("READ_ONLY");
    expect(r.readonlyUntil?.getTime()).toBe(end.getTime() + 90 * D);
  });

  it("a paid period that is still running keeps FULL even if an older grant date has passed", () => {
    const row: AccessRow = { ...grantFull(new Date(T0.getTime() - D)), subscription_status: "PREMIUM_ACTIVE", subscription_period_end: new Date(T0.getTime() + 30 * D) };
    expect(deriveAccess(row, T0, grace).mode).toBe("FULL");
  });
});

describe("deriveAccess with a recurring subscription: the provider renews, the clock waits the safety margin", () => {
  const recurring = (periodEnd: Date, status: AccessRow["subscription_status"] = "PREMIUM_ACTIVE"): AccessRow => ({
    ...full(periodEnd, status), subscription_auto_renews: true, effective_until: periodEnd,
  });
  const policy = { readonlyGraceDays: 90, renewalSafetyDays: 14 };
  it("stays FULL past the paid-through date inside the margin, then closes at the paid-through date with the window counted from it", () => {
    const end = new Date(T0.getTime() - 5 * D);
    expect(deriveAccess(recurring(end), T0, policy).mode).toBe("FULL");
    const late = new Date(T0.getTime() - 15 * D);
    const r = deriveAccess(recurring(late), T0, policy);
    expect(r.mode).toBe("READ_ONLY");
    expect(r.readonlyUntil?.getTime()).toBe(late.getTime() + 90 * D);
  });
  it("a scheduled cancellation ends exactly at the period end (no margin), and a one-time term is unaffected", () => {
    const end = new Date(T0.getTime() - D);
    expect(deriveAccess(recurring(end, "CANCELLATION_SCHEDULED"), T0, policy).mode).toBe("READ_ONLY");
    expect(deriveAccess({ ...full(end), subscription_auto_renews: false }, T0, policy).mode).toBe("READ_ONLY");
  });
});
