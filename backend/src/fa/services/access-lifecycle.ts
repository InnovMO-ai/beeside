/**
 * First Assessment access lifecycle (Handoff v1 §18, Operations & Lifecycle Control block).
 * Three lifecycles, never conflated:
 *   access          day 0 = first private link emitted; expires after `initial_access_days`
 *                   (15, provisional); +15/+30 immediate extensions; never beyond `max_access_day`
 *   communication   reminder on `reminder_day` (5 days before expiry at 15); one exceptional
 *                   recovery email on `recovery_email_day`; nothing automated after that
 *   retention       temporary data retention until `temporary_retention_day`, counted from the
 *                   access-window start — or from the lifecycle origin (identity) when no private
 *                   link was ever emitted — only while Premium was never activated
 *
 * The durations are versioned configuration: the question bank bundle may carry a `lifecycle`
 * section (pinned per project with the bundle). Changing 15 → 21 days is a new published version,
 * not a migration or a code change. fa-qb-1.0.0 predates the section and uses LIFECYCLE_POLICY_V1.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeScope = "delete_client_data_keep_anonymous_analytics";

export interface LifecyclePolicy {
  initialAccessDays: number;
  reminderDay: number;
  extensionDays: readonly number[];
  maxAccessDay: number;
  recoveryEmailDay: number;
  temporaryRetentionDay: number;
  purgeScope: PurgeScope;
}

/** Snake-case shape stored in the question bank bundle (`lifecycle`). */
export interface LifecyclePolicyConfig {
  schema_version: 1;
  initial_access_days: number;
  reminder_day: number;
  extension_days: number[];
  max_access_day: number;
  recovery_email_day: number;
  temporary_retention_day: number;
  purge_scope: PurgeScope;
}

export const LIFECYCLE_POLICY_V1: LifecyclePolicy = {
  initialAccessDays: 15,
  reminderDay: 10,
  extensionDays: [15, 30],
  maxAccessDay: 45,
  recoveryEmailDay: 21,
  temporaryRetentionDay: 60,
  purgeScope: "delete_client_data_keep_anonymous_analytics",
};

/** Backwards-compatible view of the v1 policy. */
export const ACCESS_LIFECYCLE = {
  initialAccessDays: LIFECYCLE_POLICY_V1.initialAccessDays,
  reminderDay: LIFECYCLE_POLICY_V1.reminderDay,
  recoveryEmailDay: LIFECYCLE_POLICY_V1.recoveryEmailDay,
  maxAccessDay: LIFECYCLE_POLICY_V1.maxAccessDay,
  retentionDay: LIFECYCLE_POLICY_V1.temporaryRetentionDay,
  extensionDays: [15, 30] as const,
};

export type ExtensionDays = 15 | 30;

export function lifecyclePolicyToConfig(policy: LifecyclePolicy): LifecyclePolicyConfig {
  return {
    schema_version: 1,
    initial_access_days: policy.initialAccessDays,
    reminder_day: policy.reminderDay,
    extension_days: [...policy.extensionDays],
    max_access_day: policy.maxAccessDay,
    recovery_email_day: policy.recoveryEmailDay,
    temporary_retention_day: policy.temporaryRetentionDay,
    purge_scope: policy.purgeScope,
  };
}

/** Validation errors for a lifecycle section (empty = valid); coherent calendars only. */
export function validateLifecyclePolicyConfig(config: unknown): string[] {
  const errors: string[] = [];
  if (typeof config !== "object" || config === null) return ["lifecycle must be an object"];
  const c = config as Partial<LifecyclePolicyConfig>;
  const int = (value: unknown, name: string, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) errors.push(`lifecycle.${name} must be an integer between ${min} and ${max}`);
  };
  if (c.schema_version !== 1) errors.push("lifecycle.schema_version must be 1");
  int(c.initial_access_days, "initial_access_days", 1, 90);
  int(c.reminder_day, "reminder_day", 1, 89);
  int(c.max_access_day, "max_access_day", 1, 180);
  int(c.recovery_email_day, "recovery_email_day", 2, 179);
  int(c.temporary_retention_day, "temporary_retention_day", 1, 365);
  if (!Array.isArray(c.extension_days) || c.extension_days.length === 0 || c.extension_days.some((d) => d !== 15 && d !== 30)) {
    errors.push("lifecycle.extension_days must be a non-empty subset of [15, 30] (the structured extension model)");
  }
  if (c.purge_scope !== "delete_client_data_keep_anonymous_analytics") errors.push("lifecycle.purge_scope is not a supported purge scope");
  if (errors.length > 0) return errors;
  const p = c as LifecyclePolicyConfig;
  if (p.reminder_day >= p.initial_access_days) errors.push("lifecycle.reminder_day must come before access expires");
  if (p.max_access_day < p.initial_access_days) errors.push("lifecycle.max_access_day cannot be earlier than the initial expiry");
  if (p.recovery_email_day <= p.initial_access_days || p.recovery_email_day >= p.max_access_day) {
    errors.push("lifecycle.recovery_email_day must fall after the initial expiry and before the maximum access day");
  }
  if (p.temporary_retention_day < p.max_access_day) errors.push("lifecycle.temporary_retention_day cannot end before the maximum access day");
  return errors;
}

export function lifecyclePolicyFromConfig(config: unknown): LifecyclePolicy | null {
  if (config === undefined || config === null) return null;
  if (validateLifecyclePolicyConfig(config).length > 0) return null;
  const c = config as LifecyclePolicyConfig;
  return {
    initialAccessDays: c.initial_access_days,
    reminderDay: c.reminder_day,
    extensionDays: [...c.extension_days],
    maxAccessDay: c.max_access_day,
    recoveryEmailDay: c.recovery_email_day,
    temporaryRetentionDay: c.temporary_retention_day,
    purgeScope: c.purge_scope,
  };
}

/** The policy a project runs under: its pinned bundle's section, or v1 for bundles that predate it. */
export function lifecyclePolicyOf(bundle: { lifecycle?: unknown }): { policy: LifecyclePolicy; source: "bundle" | "legacy_default" } {
  const fromBundle = lifecyclePolicyFromConfig(bundle.lifecycle);
  return fromBundle ? { policy: fromBundle, source: "bundle" } : { policy: LIFECYCLE_POLICY_V1, source: "legacy_default" };
}

export interface AccessWindow {
  startedAt: Date;
  expiresAt: Date;
  maxUntil: Date;
  retentionUntil: Date;
}

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Day 0 of access: the first private link is emitted. Retention is re-anchored to this moment. */
export function openAccessWindow(now: Date, policy: LifecyclePolicy = LIFECYCLE_POLICY_V1): AccessWindow {
  return {
    startedAt: now,
    expiresAt: addDays(now, policy.initialAccessDays),
    maxUntil: addDays(now, policy.maxAccessDay),
    retentionUntil: addDays(now, policy.temporaryRetentionDay),
  };
}

/**
 * Deterministic retention fallback when no private link has been emitted (e.g. a First Assessment
 * completed in one sitting): counted from the lifecycle origin, so no free assessment is ever
 * retained indefinitely. This does not start or imply an access window.
 */
export function retentionFromOrigin(identityCompletedAt: Date, policy: LifecyclePolicy = LIFECYCLE_POLICY_V1): Date {
  return addDays(identityCompletedAt, policy.temporaryRetentionDay);
}

export function isExtensionDays(value: unknown, policy: LifecyclePolicy = LIFECYCLE_POLICY_V1): value is ExtensionDays {
  return (value === 15 || value === 30) && policy.extensionDays.includes(value);
}

export type ExtensionOutcome =
  | { ok: true; newExpiresAt: Date; wasExpired: boolean }
  | { ok: false; reason: "maximum_reached" | "no_longer_recoverable" };

/**
 * Extends from the later of the current expiry and now (so a recovery after expiry still grants
 * real time), capped at the maximum access day. Immediate; never conditioned on any commercial action.
 */
export function extendAccess(window: Pick<AccessWindow, "expiresAt" | "maxUntil">, days: ExtensionDays, now: Date): ExtensionOutcome {
  if (now.getTime() >= window.maxUntil.getTime()) return { ok: false, reason: "no_longer_recoverable" };
  if (window.expiresAt.getTime() >= window.maxUntil.getTime()) return { ok: false, reason: "maximum_reached" };
  const base = Math.max(window.expiresAt.getTime(), now.getTime());
  const newExpiresAt = new Date(Math.min(base + days * DAY_MS, window.maxUntil.getTime()));
  return { ok: true, newExpiresAt, wasExpired: window.expiresAt.getTime() <= now.getTime() };
}

export function isAccessOpen(window: Pick<AccessWindow, "expiresAt"> | null, now: Date): boolean {
  return window === null || window.expiresAt.getTime() > now.getTime();
}

/** Whole days left until `until`, rounded up (a reminder never under-states remaining time). */
export function daysLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
}

export interface LifecycleMilestones {
  accessWindowStartedAt: Date | null;
  accessExpiresAt: Date | null;
  accessMaxUntil: Date | null;
  reminderSentAt: Date | null;
  recoverySentAt: Date | null;
}

/**
 * The single reminder: at or after `reminder_day`, once the remaining access is no longer than the
 * lead time of the policy (5 days at 15/10), while access is still open, and never after the
 * recovery email.
 */
export function reminderDue(m: LifecycleMilestones, policy: LifecyclePolicy, now: Date): boolean {
  if (!m.accessWindowStartedAt || !m.accessExpiresAt || m.reminderSentAt || m.recoverySentAt) return false;
  if (m.accessExpiresAt.getTime() <= now.getTime()) return false;
  const leadMs = (policy.initialAccessDays - policy.reminderDay) * DAY_MS;
  return now.getTime() >= addDays(m.accessWindowStartedAt, policy.reminderDay).getTime() && m.accessExpiresAt.getTime() - now.getTime() <= leadMs;
}

/**
 * The single exceptional recovery email: access expired at least (recovery_email_day −
 * initial_access_days) days ago — day 21 for an unextended 15-day window — no earlier than
 * `recovery_email_day`, and only while still recoverable (before the maximum access day).
 */
export function recoveryDue(m: LifecycleMilestones, policy: LifecyclePolicy, now: Date): boolean {
  if (!m.accessWindowStartedAt || !m.accessExpiresAt || !m.accessMaxUntil || m.recoverySentAt) return false;
  if (m.accessExpiresAt.getTime() > now.getTime() || m.accessMaxUntil.getTime() <= now.getTime()) return false;
  const afterExpiry = addDays(m.accessExpiresAt, policy.recoveryEmailDay - policy.initialAccessDays);
  return now.getTime() >= addDays(m.accessWindowStartedAt, policy.recoveryEmailDay).getTime() && now.getTime() >= afterExpiry.getTime();
}
