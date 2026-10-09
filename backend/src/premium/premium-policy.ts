/**
 * Core-owned Premium policy (F5 Track B). Stripe never owns how long Premium lasts or how long Precision stays
 * read-only afterwards: both are Core configuration, read here, never hard-coded in an adapter or in logic.
 * The values actually applied are snapshotted on the records they shaped (subscription period, entitlement
 * grace_days_applied), so changing the configuration never rewrites history.
 */
export interface PremiumPolicy {
  /** Length of the Premium access period granted by one confirmed payment (days). */
  accessPeriodDays: number;
  /** Length of the read-only window after Premium ends, before Precision access is revoked (days). */
  readonlyGraceDays: number;
}

/** Defaults used when the environment does not configure the values. A Product Owner decision, flagged in the Track B status file. */
export const DEFAULT_PREMIUM_POLICY: PremiumPolicy = { accessPeriodDays: 365, readonlyGraceDays: 90 };

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

/** PREMIUM_ACCESS_PERIOD_DAYS (1..3650) and PRECISION_READONLY_GRACE_DAYS (0..3650). */
export function premiumPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): PremiumPolicy {
  return {
    accessPeriodDays: boundedInt(env.PREMIUM_ACCESS_PERIOD_DAYS, DEFAULT_PREMIUM_POLICY.accessPeriodDays, 1, 3650, "PREMIUM_ACCESS_PERIOD_DAYS"),
    readonlyGraceDays: boundedInt(env.PRECISION_READONLY_GRACE_DAYS, DEFAULT_PREMIUM_POLICY.readonlyGraceDays, 0, 3650, "PRECISION_READONLY_GRACE_DAYS"),
  };
}

export const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
