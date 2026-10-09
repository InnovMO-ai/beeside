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
