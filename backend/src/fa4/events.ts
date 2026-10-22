import { z } from "zod";
import { Db } from "../db/database";

/**
 * Launch-day event capture (dictionary: docs/fa4/ANALYTICS_EVENTS.md). Minimal and privacy-conscious:
 *  - no IP, no user agent, no fingerprint, no email, no free text; `props` carries only catalog codes and counts;
 *  - `visit_id` is a random id the browser keeps in sessionStorage (one tab session). It never survives the tab and is not derived from the device;
 *  - append-only table, written with INSERT only. Capture never blocks or fails a user action.
 */
export const QUESTION_BANK_VERSION = "FA4_QUESTION_BANK_FINAL_2026-10";

const STEP = z.enum([
  "cover", "identity", "company", "exit", "destinations", "same_in_all", "activity", "presence", "existing", "reflection", "reason", "decision", "scale",
  "activators", "activators_sell", "activators_site", "fronts_status", "fronts_mark", "fronts_support", "fronts_critical", "cargo_route", "support_values", "extra", "result",
]);
const LOCALE = z.enum(["es", "en"]);

/** Events the browser may report (everything else is written by the server, which is the source of truth). */
export const CLIENT_EVENT_SCHEMAS = {
  visit: z.object({}).strict(),
  language_selected: z.object({ locale: LOCALE }).strict(),
  start_clicked: z.object({}).strict(),
  step_viewed: z.object({ step: STEP }).strict(),
  help_clicked: z.object({}).strict(),
  contact_opened: z.object({}).strict(),
  result_viewed: z.object({}).strict(),
} as const;
export type ClientEventName = keyof typeof CLIENT_EVENT_SCHEMAS;

export const SERVER_EVENT_NAMES = [
  "project_created", "step_reached", "result_generated", "yev_previewed", "yev_delivered", "demand_signals_recorded",
  "resume_email_requested", "resume_email_sent", "resume_email_failed", "resume_email_auto_queued",
  "yev_email_requested", "yev_email_sent", "yev_email_failed",
  "contact_submitted", "contact_email_sent", "contact_email_failed",
  "premium_continuation_requested", "marketing_opt_in_changed", "resume_link_used",
] as const;
export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number];

export const clientEventBody = z.object({
  name: z.string(),
  visitId: z.string().uuid(),
  step: STEP.optional(),
  props: z.record(z.string(), z.unknown()).optional(),
}).strict();

export interface EventRecord {
  name: ClientEventName | ServerEventName;
  source: "client" | "server";
  visitId?: string | null;
  projectId?: string | null;
  locale?: "es" | "en" | null;
  step?: string | null;
  catalogVersion?: string | null;
  props?: Record<string, string | number | boolean | string[] | null>;
}

/** Writes one event. Never throws: analytics must not break the product. Returns whether the row was stored. */
export async function recordEvent(db: Db, e: EventRecord): Promise<boolean> {
  try {
    await db.query(
      `INSERT INTO fa4_event (name, source, visit_id, project_id, locale, step, catalog_version, props) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [e.name, e.source, e.visitId ?? null, e.projectId ?? null, e.locale ?? null, e.step ?? null, e.catalogVersion ?? null,
        JSON.stringify({ questionBank: QUESTION_BANK_VERSION, ...(e.props ?? {}) })],
    );
    return true;
  } catch {
    return false;
  }
}

/** Validates a browser-reported event against the closed dictionary. Returns null when it is not acceptable. */
export function parseClientEvent(body: unknown): { name: ClientEventName; visitId: string; step?: string; props: Record<string, unknown> } | null {
  const b = clientEventBody.safeParse(body);
  if (!b.success) return null;
  const schema = (CLIENT_EVENT_SCHEMAS as Record<string, z.ZodTypeAny>)[b.data.name];
  if (!schema) return null;
  const props = schema.safeParse(b.data.props ?? {});
  if (!props.success) return null;
  return { name: b.data.name as ClientEventName, visitId: b.data.visitId, step: b.data.step, props: props.data as Record<string, unknown> };
}
