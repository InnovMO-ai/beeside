/**
 * Finish Later access lifecycle (Handoff v1 §18). Access and retention are distinct:
 *   day 0   access window opens (first private link issued)
 *   day 10  reminder "saved for 5 more days" (Phase 11 automation)
 *   day 15  access expires unless extended
 *   +15/+30 immediate extension, never beyond day 45
 *   day 21  single exceptional recovery email (Phase 11 automation)
 *   day 60  internal temporary retention ends — only if Premium was never activated
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACCESS_LIFECYCLE = {
  initialAccessDays: 15,
  reminderDay: 10,
  recoveryEmailDay: 21,
  maxAccessDay: 45,
  retentionDay: 60,
  extensionDays: [15, 30] as const,
};

export type ExtensionDays = (typeof ACCESS_LIFECYCLE.extensionDays)[number];

export interface AccessWindow {
  startedAt: Date;
  expiresAt: Date;
  maxUntil: Date;
  retentionUntil: Date;
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

export function openAccessWindow(now: Date): AccessWindow {
  return {
    startedAt: now,
    expiresAt: addDays(now, ACCESS_LIFECYCLE.initialAccessDays),
    maxUntil: addDays(now, ACCESS_LIFECYCLE.maxAccessDay),
    retentionUntil: addDays(now, ACCESS_LIFECYCLE.retentionDay),
  };
}

export function isExtensionDays(value: unknown): value is ExtensionDays {
  return value === 15 || value === 30;
}

export type ExtensionOutcome =
  | { ok: true; newExpiresAt: Date; wasExpired: boolean }
  | { ok: false; reason: "maximum_reached" | "no_longer_recoverable" };

/**
 * Extends from the later of the current expiry and now (so a recovery after expiry still grants
 * real time), capped at the day-45 maximum. Immediate; never conditioned on any commercial action.
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
