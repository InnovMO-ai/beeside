import type { Db } from "../db/database";
import { V1_EVENTS, type V1EventName } from "./v1-events";
import type { AnalyticsRange } from "./metrics";

/**
 * Canonical Precision V1.0 metrics (Product / AI experience / Commercial). One definition each, computed from the `analytics_v1_*` views —
 * the SAME views Tableau reads with the read-only role `beeside_analytics_reader` (migration 0034). This file is the internal operational
 * surface; it is not a second analytics pipeline. Nothing here reads conversation text, answers, e-mail or names.
 *
 * `status`: `live` = the behaviour exists and the event is emitted; `awaiting_product_layer` = the metric is defined and wired to its catalog
 * event, but the behaviour that produces it belongs to the Fase 1 product layer (the number is honestly 0 / null until then — it is never
 * approximated from something else).
 */
export type MetricFamily = "funnel" | "quality" | "ai" | "commercial";
export interface MetricDef { id: string; family: MetricFamily; label: string; definition: string; unit: "projects" | "count" | "rate" | "ms_bucket"; status: "live" | "awaiting_product_layer"; source: string }

const defined = (event: V1EventName): "live" | "awaiting_product_layer" => (V1_EVENTS[event].status === "emitted" ? "live" : "awaiting_product_layer");

export const METRIC_CATALOG: readonly MetricDef[] = [
  // ---- product funnel (cohort: projects whose Precision was opened in the range) ----
  { id: "funnel.precision_opened", family: "funnel", label: "Precision opened", definition: "Projects whose first Precision visit falls in the range (the cohort).", unit: "projects", status: "live", source: "analytics_v1_project_funnel.precision_opened_at" },
  { id: "funnel.understanding_started", family: "funnel", label: "Understanding started", definition: "Cohort projects that sent a first Understanding turn.", unit: "projects", status: "live", source: "understanding_started" },
  { id: "funnel.understanding_completed", family: "funnel", label: "Understanding completed", definition: "Cohort projects whose Understanding reached ready-to-confirm (My Service Map ready).", unit: "projects", status: "live", source: "my_service_map_ready" },
  { id: "funnel.service_map_confirmed", family: "funnel", label: "Service Map confirmed", definition: "Cohort projects that confirmed My Service Map.", unit: "projects", status: "live", source: "my_service_map_confirmed" },
  { id: "funnel.category_started", family: "funnel", label: "Category started", definition: "Cohort projects that started at least one category conversation.", unit: "projects", status: "live", source: "category_started" },
  { id: "funnel.crp_ready", family: "funnel", label: "CRP ready", definition: "Cohort projects with at least one category ready for review.", unit: "projects", status: "live", source: "crp_ready_for_review" },
  { id: "funnel.crp_confirmed", family: "funnel", label: "CRP confirmed", definition: "Cohort projects that confirmed at least one CRP.", unit: "projects", status: "live", source: "crp_confirmed" },
  { id: "funnel.preview", family: "funnel", label: "Preview", definition: "Cohort projects that opened a handoff preview.", unit: "projects", status: "live", source: "handoff_previewed" },
  { id: "funnel.send", family: "funnel", label: "Send", definition: "Cohort projects with a completed send to Operation Hub.", unit: "projects", status: "live", source: "operation_hub_send_completed" },
  { id: "funnel.oh_accepted", family: "funnel", label: "Operation Hub accepted", definition: "Cohort projects whose handoff the Operation Hub accepted and activated.", unit: "projects", status: "live", source: "operation_hub_activated" },
  // ---- quality / AI experience ----
  { id: "quality.process_question_rate", family: "quality", label: "Process-question rate", definition: "Client process questions (\"why do you ask?\") over all client turns.", unit: "rate", status: "live", source: "analytics_v1_turns" },
  { id: "quality.add_service_started", family: "quality", label: "Add a Service started", definition: "Add a Service conversations opened.", unit: "count", status: "live", source: "add_service_started" },
  { id: "quality.add_service_completed", family: "quality", label: "Add a Service completed", definition: "Add a Service conversations that ended in a confirmed need.", unit: "count", status: "live", source: "add_service_completed" },
  { id: "quality.unknown_legitimate_need", family: "quality", label: "Unknown legitimate need", definition: "Needs outside the known catalog that were kept for review instead of being dropped.", unit: "count", status: "live", source: "possible_new_service_detected" },
  { id: "quality.crp_change_requests", family: "quality", label: "CRP correction requests", definition: "Times a client asked to change a CRP that was ready or confirmed.", unit: "count", status: "live", source: "crp_change_requested" },
  { id: "quality.critical_items_open_rate", family: "quality", label: "Critical items still open", definition: "Critical items created minus resolved, over created.", unit: "rate", status: "live", source: "critical_item_created / critical_item_resolved" },
  { id: "quality.service_map_corrected", family: "quality", label: "Service Map corrected", definition: "Client corrections to My Service Map after it was shown.", unit: "count", status: defined("service_map_corrected"), source: "service_map_corrected" },
  { id: "quality.noise_filtered", family: "quality", label: "Noise filtered", definition: "Turns classified as noise and kept out of the project.", unit: "count", status: defined("turn_class_detected"), source: "turn_class_detected (answer_class = noise)" },
  { id: "quality.service_need_routed", family: "quality", label: "Needs routed", definition: "Needs by route: known, unknown legitimate, ambiguous, noise.", unit: "count", status: defined("service_need_routed"), source: "service_need_routed" },
  { id: "quality.client_priority_captured", family: "quality", label: "Client priority captured", definition: "Times the client set the priority order of their needs.", unit: "count", status: defined("client_priority_set"), source: "client_priority_set" },
  { id: "quality.understanding_depth", family: "quality", label: "Understanding depth reached", definition: "Understanding conversations by depth level reached (minimal, sufficient, deep).", unit: "count", status: defined("understanding_depth_reached"), source: "understanding_depth_reached" },
  { id: "quality.repeated_question_rate", family: "quality", label: "Repeated-question rate", definition: "Assistant questions that re-ask something already known or already answered, over assistant questions.", unit: "rate", status: "awaiting_product_layer", source: "needs the fact-lifecycle layer (Fase 1)" },
  { id: "quality.correction_rate", family: "quality", label: "Correction rate", definition: "Client corrections of something the assistant had captured, over captured facts.", unit: "rate", status: "awaiting_product_layer", source: "needs the fact-lifecycle layer (Fase 1)" },
  { id: "quality.clarification_loops", family: "quality", label: "Clarification loops", definition: "Conversations that needed more than one clarification round on the same point.", unit: "count", status: "awaiting_product_layer", source: "needs the comprehension layer (Fase 1)" },
  { id: "quality.misunderstanding_repair", family: "quality", label: "Misunderstanding repair", definition: "Misunderstandings the client signalled that were repaired in the next turn.", unit: "rate", status: "awaiting_product_layer", source: "needs the comprehension layer (Fase 1)" },
  { id: "ai.turns", family: "ai", label: "AI turns", definition: "Processed turns by surface, outcome and latency bucket.", unit: "count", status: "live", source: "ai_turn_completed" },
  { id: "ai.unavailable_rate", family: "ai", label: "AI unavailable rate", definition: "Turns answered with the 'unavailable' outcome over all processed turns.", unit: "rate", status: "live", source: "ai_turn_completed" },
  { id: "ai.fallback_rate", family: "ai", label: "Model fallback rate", definition: "Turns that used a fallback model tier.", unit: "rate", status: defined("ai_fallback_used"), source: "ai_fallback_used" },
  // ---- commercial ----
  { id: "commercial.access_by_mode", family: "commercial", label: "Access now", definition: "Projects by current access mode (FULL, READ_ONLY, REVOKED).", unit: "projects", status: "live", source: "analytics_v1_entitlement_state" },
  { id: "commercial.access_by_source", family: "commercial", label: "Entitlement source", definition: "Projects by the source that currently opens their access (paid, complimentary, promotion, sponsored, trial, partner, manual).", unit: "projects", status: "live", source: "analytics_v1_entitlement_state.sources" },
  { id: "commercial.events", family: "commercial", label: "Commercial events", definition: "Grants, extensions, endings, mode changes, program events, activations, renewals and reactivations in the range.", unit: "count", status: "live", source: "analytics_v1_commercial_events" },
  { id: "commercial.privacy", family: "commercial", label: "Privacy state", definition: "Projects by privacy state (open, blocked, anonymized).", unit: "projects", status: "live", source: "analytics_v1_entitlement_state.privacy_state" },
];

const round = (value: number): number => Math.round(value * 1000) / 1000;
const rate = (n: number, d: number): number | null => (d === 0 ? null : round(n / d));
const num = (v: unknown): number => Number(v ?? 0);

export interface PrecisionFunnel { range: { from: string; to: string }; stages: Array<{ id: string; label: string; projects: number; ofOpened: number | null; ofPrevious: number | null }> }

export async function precisionFunnel(db: Db, range: AnalyticsRange): Promise<PrecisionFunnel> {
  const { rows } = await db.query<Record<string, string>>(
    `SELECT count(*) AS opened,
            count(understanding_started_at) AS understanding_started, count(understanding_completed_at) AS understanding_completed,
            count(service_map_confirmed_at) AS service_map_confirmed, count(first_category_started_at) AS category_started,
            count(first_crp_ready_at) AS crp_ready, count(first_crp_confirmed_at) AS crp_confirmed, count(first_preview_at) AS preview,
            count(first_send_at) AS send, count(first_oh_accepted_at) AS oh_accepted
       FROM analytics_v1_project_funnel WHERE precision_opened_at >= $1 AND precision_opened_at < $2`,
    [range.from, range.to],
  );
  const r = rows[0] ?? {};
  const ids = ["opened", "understanding_started", "understanding_completed", "service_map_confirmed", "category_started", "crp_ready", "crp_confirmed", "preview", "send", "oh_accepted"] as const;
  const labels: Record<(typeof ids)[number], string> = {
    opened: "Precision opened", understanding_started: "Understanding started", understanding_completed: "Understanding completed", service_map_confirmed: "Service Map confirmed",
    category_started: "Category started", crp_ready: "CRP ready", crp_confirmed: "CRP confirmed", preview: "Preview", send: "Send", oh_accepted: "Operation Hub accepted",
  };
  const opened = num(r.opened);
  let previous = opened;
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    stages: ids.map((id) => {
      const projects = num(r[id]);
      const stage = { id: `funnel.${id}`, label: labels[id], projects, ofOpened: rate(projects, opened), ofPrevious: rate(projects, previous) };
      previous = projects;
      return stage;
    }),
  };
}

export async function precisionQuality(db: Db, range: AnalyticsRange) {
  const events = await db.query<{ event_name: string; n: string; by_property: Record<string, number> | null }>(
    `SELECT event_name, count(*) AS n FROM analytics_v1_events
      WHERE channel = 'precision' AND occurred_at >= $1 AND occurred_at < $2
        AND event_name IN ('add_service_started', 'add_service_completed', 'possible_new_service_detected', 'crp_change_requested', 'critical_item_created', 'critical_item_resolved',
                           'service_map_corrected', 'client_priority_set', 'service_need_routed', 'turn_class_detected', 'understanding_depth_reached')
      GROUP BY event_name`,
    [range.from, range.to],
  );
  const by = Object.fromEntries(events.rows.map((e) => [e.event_name, num(e.n)]));
  const turns = await db.query<{ client_turns: string; process_questions: string }>(
    `SELECT count(*) FILTER (WHERE role = 'client') AS client_turns, count(*) FILTER (WHERE role = 'client' AND kind = 'process_question') AS process_questions
       FROM analytics_v1_turns WHERE occurred_at >= $1 AND occurred_at < $2`,
    [range.from, range.to],
  );
  const split = async (event: string, property: string): Promise<Record<string, number>> => {
    const { rows } = await db.query<{ v: string | null; n: string }>(
      `SELECT properties ->> $3 AS v, count(*) AS n FROM analytics_v1_events WHERE channel = 'precision' AND event_name = $4 AND occurred_at >= $1 AND occurred_at < $2 GROUP BY 1`,
      [range.from, range.to, property, event],
    );
    return Object.fromEntries(rows.map((r) => [r.v ?? "unknown", num(r.n)]));
  };
  const created = by.critical_item_created ?? 0;
  const resolved = by.critical_item_resolved ?? 0;
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    processQuestionRate: rate(num(turns.rows[0]?.process_questions), num(turns.rows[0]?.client_turns)),
    clientTurns: num(turns.rows[0]?.client_turns),
    addService: { started: by.add_service_started ?? 0, completed: by.add_service_completed ?? 0, completionRate: rate(by.add_service_completed ?? 0, by.add_service_started ?? 0) },
    unknownLegitimateNeed: by.possible_new_service_detected ?? 0,
    crpChangeRequests: by.crp_change_requested ?? 0,
    criticalItems: { created, resolved, openRate: rate(Math.max(created - resolved, 0), created) },
    serviceMapCorrected: by.service_map_corrected ?? 0,
    clientPriorityCaptured: by.client_priority_set ?? 0,
    needsRouted: await split("service_need_routed", "route"),
    turnClasses: await split("turn_class_detected", "answer_class"),
    understandingDepth: await split("understanding_depth_reached", "level"),
    awaitingProductLayer: METRIC_CATALOG.filter((m) => m.family === "quality" && m.status === "awaiting_product_layer").map((m) => m.id),
  };
}

export async function precisionAi(db: Db, range: AnalyticsRange) {
  const { rows } = await db.query<{ surface: string | null; status: string | null; latency: string | null; n: string }>(
    `SELECT properties ->> 'surface' AS surface, properties ->> 'status' AS status, properties ->> 'latency_bucket' AS latency, count(*) AS n
       FROM analytics_v1_events WHERE channel = 'precision' AND event_name = 'ai_turn_completed' AND occurred_at >= $1 AND occurred_at < $2 GROUP BY 1, 2, 3`,
    [range.from, range.to],
  );
  const total = rows.reduce((s, r) => s + num(r.n), 0);
  const unavailable = rows.filter((r) => r.status === "ai_unavailable").reduce((s, r) => s + num(r.n), 0);
  const bySurface: Record<string, { turns: number; unavailable: number; latency: Record<string, number> }> = {};
  for (const r of rows) {
    const s = (bySurface[r.surface ?? "unknown"] ??= { turns: 0, unavailable: 0, latency: {} });
    s.turns += num(r.n);
    if (r.status === "ai_unavailable") s.unavailable += num(r.n);
    s.latency[r.latency ?? "unknown"] = (s.latency[r.latency ?? "unknown"] ?? 0) + num(r.n);
  }
  const fallback = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM analytics_v1_events WHERE channel = 'precision' AND event_name = 'ai_fallback_used' AND occurred_at >= $1 AND occurred_at < $2",
    [range.from, range.to],
  );
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    turns: total,
    unavailableRate: rate(unavailable, total),
    fallback: { turns: num(fallback.rows[0]?.n), rate: rate(num(fallback.rows[0]?.n), total), status: defined("ai_fallback_used") },
    bySurface,
  };
}

export async function precisionCommercial(db: Db, range: AnalyticsRange) {
  const state = await db.query<{ access_mode: string; privacy_state: string; source: string | null; n: string }>(
    `SELECT access_mode, privacy_state, s AS source, count(*) AS n
       FROM analytics_v1_entitlement_state e LEFT JOIN LATERAL unnest(CASE WHEN cardinality(e.sources) = 0 THEN ARRAY[NULL::text] ELSE e.sources END) s ON true
      GROUP BY 1, 2, 3`,
  );
  const projects = await db.query<{ n: string; mode: string; privacy: string }>(
    "SELECT count(*) AS n, access_mode AS mode, privacy_state AS privacy FROM analytics_v1_entitlement_state GROUP BY 2, 3",
  );
  const byMode: Record<string, number> = {};
  const byPrivacy: Record<string, number> = {};
  for (const r of projects.rows) {
    byMode[r.mode] = (byMode[r.mode] ?? 0) + num(r.n);
    byPrivacy[r.privacy] = (byPrivacy[r.privacy] ?? 0) + num(r.n);
  }
  const bySource: Record<string, number> = {};
  for (const r of state.rows) if (r.source) bySource[r.source] = (bySource[r.source] ?? 0) + num(r.n);
  const events = await db.query<{ event_name: string; source_type: string | null; n: string }>(
    `SELECT event_name, source_type, count(*) AS n FROM analytics_v1_commercial_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1, 2`,
    [range.from, range.to],
  );
  const counts: Record<string, number> = {};
  const grantsBySource: Record<string, number> = {};
  for (const e of events.rows) {
    counts[e.event_name] = (counts[e.event_name] ?? 0) + num(e.n);
    if (e.event_name === "entitlement_granted") grantsBySource[e.source_type ?? "unknown"] = (grantsBySource[e.source_type ?? "unknown"] ?? 0) + num(e.n);
  }
  const modeChanges = await db.query<{ to_mode: string; n: string }>(
    `SELECT to_mode, count(*) AS n FROM analytics_v1_commercial_events WHERE event_name = 'entitlement_mode_changed' AND occurred_at >= $1 AND occurred_at < $2 GROUP BY 1`,
    [range.from, range.to],
  );
  const toMode = Object.fromEntries(modeChanges.rows.map((r) => [r.to_mode, num(r.n)]));
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    now: { byMode, bySource, byPrivacy },
    period: {
      activations: counts.premium_activated ?? 0,
      renewals: counts.subscription_renewed ?? 0,
      reactivations: counts.premium_reactivated ?? 0,
      cancellationsRequested: counts.cancellation_requested ?? 0,
      periodsEnded: counts.subscription_period_ended ?? 0,
      grantsIssued: counts.entitlement_granted ?? 0,
      grantsBySource,
      grantsExtended: counts.entitlement_extended ?? 0,
      entitlementsEnded: counts.entitlement_ended ?? 0,
      movedToReadOnly: toMode.READ_ONLY ?? 0,
      movedToRevoked: toMode.REVOKED ?? 0,
      programsActivated: counts.program_activated ?? 0,
      programsRedeemed: counts.program_redeemed ?? 0,
      programsClosed: counts.program_closed ?? 0,
      privacyBlocks: counts.privacy_block_applied ?? 0,
    },
  };
}
