import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * First Assessment analytics (Phase 12). Every number here is computed from journey events, the
 * anonymous segmentation profile and operational tables — never from answer content, names,
 * emails or open text. Segments smaller than MIN_SEGMENT_SIZE are suppressed rather than shown, so
 * an aggregate can never single out one company.
 */

export const MIN_SEGMENT_SIZE = 5;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const TOKEN = /^[a-z0-9_]{1,64}$/;
const COUNTRY = /^[A-Z]{2}$/;

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export interface SegmentFilter {
  primaryGoal: string | null;
  entryMode: string | null;
  businessType: string | null;
  destinationStatus: string | null;
  market: string | null;
  capability: string | null;
  component: string | null;
}

export const EMPTY_SEGMENT: SegmentFilter = {
  primaryGoal: null,
  entryMode: null,
  businessType: null,
  destinationStatus: null,
  market: null,
  capability: null,
  component: null,
};

export function parseRange(query: Record<string, unknown>, now: Date): AnalyticsRange {
  const day = (value: unknown, fallback: Date): Date => {
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FaError("INVALID_INPUT", "dates must be YYYY-MM-DD", { fields: ["from", "to"] });
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new FaError("INVALID_INPUT", "invalid date", { fields: ["from", "to"] });
    return parsed;
  };
  const endOfToday = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
  const to = query.to === undefined || query.to === "" ? endOfToday : new Date(day(query.to, endOfToday).getTime() + DAY_MS);
  const from = day(query.from, new Date(to.getTime() - 30 * DAY_MS));
  if (from.getTime() >= to.getTime()) throw new FaError("INVALID_INPUT", "from must be before to", { fields: ["from"] });
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) throw new FaError("INVALID_INPUT", `the range cannot exceed ${MAX_RANGE_DAYS} days`, { fields: ["from"] });
  return { from, to };
}

export function parseSegment(query: Record<string, unknown>): SegmentFilter {
  const value = (name: string, pattern: RegExp): string | null => {
    const raw = query[name];
    if (raw === undefined || raw === "") return null;
    if (typeof raw !== "string" || !pattern.test(raw)) throw new FaError("INVALID_INPUT", `${name} must be an enumerated value`, { fields: [name] });
    return raw;
  };
  return {
    primaryGoal: value("primaryGoal", TOKEN),
    entryMode: value("entryMode", /^(new_market|already_operating)$/),
    businessType: value("businessType", TOKEN),
    destinationStatus: value("destinationStatus", TOKEN),
    market: value("market", COUNTRY),
    capability: value("capability", TOKEN),
    component: value("component", TOKEN),
  };
}

export function isSegmented(segment: SegmentFilter): boolean {
  return Object.values(segment).some((v) => v !== null);
}

/** The project cohort of a range and segment: $1..$9 of every query below. */
const COHORT = `
  WITH cohort AS (
    SELECT p.project_id, p.created_at, p.assessment_state, l.completed_at, l.access_expires_at, l.identity_completed_at
      FROM project p
      LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
      LEFT JOIN analytics_project_profile a ON a.project_id = p.project_id
     WHERE p.created_at >= $1 AND p.created_at < $2
       AND ($3::text IS NULL OR a.primary_goal = $3)
       AND ($4::text IS NULL OR a.entry_mode = $4)
       AND ($5::text IS NULL OR a.business_type = $5)
       AND ($6::text IS NULL OR a.destination_status = $6)
       AND ($7::text IS NULL OR $7 = ANY(a.target_markets))
       AND ($8::text IS NULL OR $8 = ANY(a.expected_capabilities))
       AND ($9::text IS NULL OR $9 = ANY(a.operation_components)))`;

function params(range: AnalyticsRange, segment: SegmentFilter): unknown[] {
  return [range.from, range.to, segment.primaryGoal, segment.entryMode, segment.businessType, segment.destinationStatus, segment.market, segment.capability, segment.component];
}

const suppress = (count: number, size: number): number | null => (size < MIN_SEGMENT_SIZE ? null : count);

export interface FunnelResult {
  range: { from: string; to: string };
  segmented: boolean;
  suppressed: boolean;
  anonymous: { entered: number; started: number } | null;
  projects: Record<string, number | null>;
  rates: Record<string, number | null>;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
const rate = (numerator: number | null, denominator: number | null): number | null =>
  numerator === null || denominator === null || denominator === 0 ? null : round(numerator / denominator);

export async function funnel(db: Db, range: AnalyticsRange, segment: SegmentFilter): Promise<FunnelResult> {
  const { rows } = await db.query<Record<string, string>>(
    `${COHORT},
     ev AS (SELECT DISTINCT e.project_id, e.event_type FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id)
     SELECT (SELECT count(*) FROM cohort) AS identity_completed,
            count(*) FILTER (WHERE event_type = 'finish_later_clicked') AS finish_later,
            count(*) FILTER (WHERE event_type = 'assessment_resumed') AS resumed,
            count(*) FILTER (WHERE event_type = 'assessment_completed') AS completed,
            count(*) FILTER (WHERE event_type IN ('snapshot_viewed', 'snapshot_opened')) AS snapshot_viewed,
            count(*) FILTER (WHERE event_type = 'preview_room_clicked') AS preview_room_clicked,
            count(*) FILTER (WHERE event_type = 'premium_continue_clicked') AS premium_interest,
            count(*) FILTER (WHERE event_type = 'premium_activation_requested') AS premium_requested,
            count(*) FILTER (WHERE event_type = 'premium_activated') AS premium_activated,
            count(*) FILTER (WHERE event_type = 'feedback_submitted') AS feedback_submitted
       FROM ev`,
    params(range, segment),
  );
  const r = rows[0] ?? {};
  const n = (key: string): number => Number(r[key] ?? 0);
  const size = n("identity_completed");
  const projects: Record<string, number | null> = {};
  for (const key of ["identity_completed", "finish_later", "resumed", "completed", "snapshot_viewed", "preview_room_clicked", "premium_interest", "premium_requested", "premium_activated", "feedback_submitted"]) {
    projects[key] = suppress(n(key), size);
  }

  let anonymous: FunnelResult["anonymous"] = null;
  if (!isSegmented(segment)) {
    const top = await db.query<{ entered: string; started: string }>(
      `SELECT count(DISTINCT anonymous_session_id) FILTER (WHERE event_type = 'assessment_entered') AS entered,
              count(DISTINCT anonymous_session_id) FILTER (WHERE event_type = 'assessment_started') AS started
         FROM fa_journey_event WHERE occurred_at >= $1 AND occurred_at < $2 AND anonymous_session_id IS NOT NULL`,
      [range.from, range.to],
    );
    anonymous = { entered: Number(top.rows[0]?.entered ?? 0), started: Number(top.rows[0]?.started ?? 0) };
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    segmented: isSegmented(segment),
    suppressed: size < MIN_SEGMENT_SIZE,
    anonymous,
    projects,
    rates: {
      started_to_identity: anonymous ? rate(size, anonymous.started) : null,
      identity_to_completed: rate(projects.completed ?? null, projects.identity_completed ?? null),
      completed_to_snapshot_viewed: rate(projects.snapshot_viewed ?? null, projects.completed ?? null),
      snapshot_to_premium_interest: rate(projects.premium_interest ?? null, projects.snapshot_viewed ?? null),
      premium_interest_to_requested: rate(projects.premium_requested ?? null, projects.premium_interest ?? null),
      identity_to_premium_activated: rate(projects.premium_activated ?? null, projects.identity_completed ?? null),
      finish_later_to_resumed: rate(projects.resumed ?? null, projects.finish_later ?? null),
    },
  };
}

export async function journeyHealth(db: Db, range: AnalyticsRange, segment: SegmentFilter, now: Date) {
  const values = [...params(range, segment), now];
  const outcome = await db.query<{ completed: string; abandoned: string; in_progress: string; total: string }>(
    `${COHORT}
     SELECT count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
            count(*) FILTER (WHERE completed_at IS NULL AND (assessment_state IN ('EXPIRED', 'DELETED') OR (access_expires_at IS NOT NULL AND access_expires_at <= $10))) AS abandoned,
            count(*) FILTER (WHERE completed_at IS NULL AND assessment_state = 'IN_PROGRESS' AND (access_expires_at IS NULL OR access_expires_at > $10)) AS in_progress,
            count(*) AS total
       FROM cohort`,
    values,
  );
  const timing = await db.query<{ active_median_minutes: string | null; active_p75_minutes: string | null; calendar_median_hours: string | null }>(
    `${COHORT},
     active AS (
       SELECT e.project_id, sum(e.duration_ms) / 60000.0 AS minutes
         FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id
        WHERE e.event_type = 'step_completed' AND e.duration_ms IS NOT NULL
        GROUP BY e.project_id)
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS active_median_minutes,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY minutes) AS active_p75_minutes,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - identity_completed_at)) / 3600.0)
               FROM cohort WHERE completed_at IS NOT NULL AND identity_completed_at IS NOT NULL) AS calendar_median_hours
       FROM active`,
    params(range, segment),
  );
  const resume = await db.query<{ finish_later: string; resumed: string; resumed_completed: string }>(
    `${COHORT},
     ev AS (SELECT DISTINCT e.project_id, e.event_type FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id)
     SELECT count(DISTINCT project_id) FILTER (WHERE event_type = 'finish_later_clicked') AS finish_later,
            count(DISTINCT project_id) FILTER (WHERE event_type = 'assessment_resumed') AS resumed,
            (SELECT count(*) FROM cohort c WHERE c.completed_at IS NOT NULL
               AND EXISTS (SELECT 1 FROM ev WHERE ev.project_id = c.project_id AND ev.event_type = 'assessment_resumed')) AS resumed_completed
       FROM ev`,
    params(range, segment),
  );
  const extensions = await db.query<{ reason: string; requested_days: number; was_expired: boolean; n: string }>(
    `${COHORT}
     SELECT x.reason::text AS reason, x.requested_days, x.was_expired, count(*) AS n
       FROM fa_access_extension x JOIN cohort c ON c.project_id = x.project_id
      GROUP BY 1, 2, 3 ORDER BY 1, 2`,
    params(range, segment),
  );
  const lifecycle = await db.query<{ reminders: string; recoveries: string; expiries: string; purged: string }>(
    `${COHORT},
     ev AS (SELECT e.project_id, e.event_type FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id)
     SELECT count(*) FILTER (WHERE event_type = 'access_reminder_sent') AS reminders,
            count(*) FILTER (WHERE event_type = 'access_recovery_email_sent') AS recoveries,
            count(*) FILTER (WHERE event_type = 'assessment_expired') AS expiries,
            (SELECT count(*) FROM retention_purge_record r JOIN cohort c ON c.project_id = r.project_id) AS purged
       FROM ev`,
    params(range, segment),
  );

  const o = outcome.rows[0];
  const total = Number(o?.total ?? 0);
  const suppressed = total < MIN_SEGMENT_SIZE;
  const t = timing.rows[0];
  const re = resume.rows[0];
  return {
    suppressed,
    outcomes: suppressed
      ? {}
      : {
          total,
          completed: Number(o?.completed ?? 0),
          abandoned: Number(o?.abandoned ?? 0),
          inProgress: Number(o?.in_progress ?? 0),
          completionRate: rate(Number(o?.completed ?? 0), total),
          abandonmentRate: rate(Number(o?.abandoned ?? 0), total),
        },
    timing: suppressed
      ? {}
      : {
          activeMedianMinutes: t?.active_median_minutes === null || t?.active_median_minutes === undefined ? null : round(Number(t.active_median_minutes)),
          activeP75Minutes: t?.active_p75_minutes === null || t?.active_p75_minutes === undefined ? null : round(Number(t.active_p75_minutes)),
          calendarMedianHours: t?.calendar_median_hours === null || t?.calendar_median_hours === undefined ? null : round(Number(t.calendar_median_hours)),
        },
    resume: suppressed
      ? {}
      : {
          finishLater: Number(re?.finish_later ?? 0),
          resumed: Number(re?.resumed ?? 0),
          resumedAndCompleted: Number(re?.resumed_completed ?? 0),
          resumeRate: rate(Number(re?.resumed ?? 0), Number(re?.finish_later ?? 0)),
        },
    extensions: suppressed ? [] : extensions.rows.map((r) => ({ reason: r.reason, days: r.requested_days, afterExpiry: r.was_expired, projects: Number(r.n) })),
    lifecycle: suppressed
      ? {}
      : {
          remindersSent: Number(lifecycle.rows[0]?.reminders ?? 0),
          recoveryEmailsSent: Number(lifecycle.rows[0]?.recoveries ?? 0),
          accessExpiries: Number(lifecycle.rows[0]?.expiries ?? 0),
          purged: Number(lifecycle.rows[0]?.purged ?? 0),
        },
  };
}

export async function friction(db: Db, range: AnalyticsRange, segment: SegmentFilter, now: Date) {
  const dropOff = await db.query<{ step_id: string | null; projects: string }>(
    `${COHORT},
     abandoned AS (SELECT project_id FROM cohort WHERE completed_at IS NULL AND (assessment_state IN ('EXPIRED', 'DELETED') OR (access_expires_at IS NOT NULL AND access_expires_at <= $10))),
     last_step AS (
       SELECT a.project_id,
              (SELECT e.step_id FROM fa_journey_event e
                WHERE e.project_id = a.project_id AND e.event_type = 'step_completed' AND e.step_id IS NOT NULL
                ORDER BY e.occurred_at DESC LIMIT 1) AS step_id
         FROM abandoned a)
     SELECT step_id, count(*) AS projects FROM last_step GROUP BY step_id ORDER BY count(*) DESC`,
    [...params(range, segment), now],
  );
  const questions = await db.query<{ question_id: string; answered: string; not_sure: string }>(
    `${COHORT},
     saved AS (SELECT DISTINCT e.project_id, e.question_id, e.value_state FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id
                WHERE e.event_type = 'answer_saved' AND e.question_id IS NOT NULL)
     SELECT question_id,
            count(DISTINCT project_id) AS answered,
            count(DISTINCT project_id) FILTER (WHERE value_state = 'not_sure') AS not_sure
       FROM saved GROUP BY question_id ORDER BY not_sure DESC, question_id`,
    params(range, segment),
  );
  const steps = await db.query<{ step_id: string; median_minutes: string | null; completions: string }>(
    `${COHORT}
     SELECT e.step_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY e.duration_ms) / 60000.0 AS median_minutes, count(*) AS completions
       FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id
      WHERE e.event_type = 'step_completed' AND e.step_id IS NOT NULL
      GROUP BY e.step_id ORDER BY e.step_id`,
    params(range, segment),
  );
  const signals = await db.query<{ save_failed: string; step_back: string; bot_signals: string }>(
    `${COHORT},
     ev AS (SELECT e.event_type, e.project_id FROM fa_journey_event e JOIN cohort c ON c.project_id = e.project_id)
     SELECT count(*) FILTER (WHERE event_type = 'save_failed') AS save_failed,
            count(*) FILTER (WHERE event_type = 'step_back_navigated') AS step_back,
            (SELECT count(*) FROM fa_journey_event WHERE event_type = 'bot_signal_detected' AND occurred_at >= $1 AND occurred_at < $2) AS bot_signals
       FROM ev`,
    params(range, segment),
  );
  const cohortSize = await db.query<{ n: string }>(`${COHORT} SELECT count(*) AS n FROM cohort`, params(range, segment));
  const size = Number(cohortSize.rows[0]?.n ?? 0);
  if (size < MIN_SEGMENT_SIZE) return { suppressed: true, dropOffByStep: [], questions: [], steps: [], signals: {} };
  return {
    suppressed: false,
    dropOffByStep: dropOff.rows.map((r) => ({ stepId: r.step_id ?? "before_first_step", projects: Number(r.projects) })),
    questions: questions.rows
      .map((r) => ({ questionId: r.question_id, answered: Number(r.answered), notSure: Number(r.not_sure), notSureRate: rate(Number(r.not_sure), Number(r.answered)) }))
      .filter((q) => q.answered >= MIN_SEGMENT_SIZE),
    steps: steps.rows.map((r) => ({ stepId: r.step_id, medianMinutes: r.median_minutes === null ? null : round(Number(r.median_minutes)), completions: Number(r.completions) })),
    signals: {
      saveFailed: Number(signals.rows[0]?.save_failed ?? 0),
      stepBackNavigated: Number(signals.rows[0]?.step_back ?? 0),
      automatedSignals: Number(signals.rows[0]?.bot_signals ?? 0),
    },
  };
}

export async function feedbackMetrics(db: Db, range: AnalyticsRange, segment: SegmentFilter) {
  const summary = await db.query<{ responses: string; average: string | null; completed: string; r1: string; r2: string; r3: string; r4: string; r5: string }>(
    `${COHORT},
     fb AS (SELECT f.usefulness FROM snapshot_feedback f JOIN cohort c ON c.project_id = f.project_id)
     SELECT count(*) AS responses, avg(usefulness)::numeric(10,2) AS average,
            (SELECT count(*) FROM cohort WHERE completed_at IS NOT NULL) AS completed,
            count(*) FILTER (WHERE usefulness = 1) AS r1, count(*) FILTER (WHERE usefulness = 2) AS r2,
            count(*) FILTER (WHERE usefulness = 3) AS r3, count(*) FILTER (WHERE usefulness = 4) AS r4,
            count(*) FILTER (WHERE usefulness = 5) AS r5
       FROM fb`,
    params(range, segment),
  );
  const s = summary.rows[0];
  const responses = Number(s?.responses ?? 0);
  const completed = Number(s?.completed ?? 0);
  return {
    responses,
    completed,
    responseRate: rate(responses, completed),
    average: s?.average === null || s?.average === undefined ? null : Number(s.average),
    distribution: [1, 2, 3, 4, 5].map((value, i) => ({ value, responses: Number([s?.r1, s?.r2, s?.r3, s?.r4, s?.r5][i] ?? 0) })),
  };
}

/**
 * The optional comments themselves. Client content, so it is never aggregated into analytics and
 * never joined with a name, email or company here; reading it is an audited Control Center action.
 */
export async function feedbackComments(db: Db, range: AnalyticsRange, limit = 50) {
  const { rows } = await db.query(
    `SELECT f.project_id, f.usefulness, f.comment, f.interface_language, f.channel, f.submitted_at
       FROM snapshot_feedback f
      WHERE f.comment IS NOT NULL AND f.submitted_at >= $1 AND f.submitted_at < $2
      ORDER BY f.submitted_at DESC LIMIT $3`,
    [range.from, range.to, Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
}

export async function segmentBreakdown(db: Db, range: AnalyticsRange) {
  const dimension = async (expression: string) => {
    const { rows } = await db.query<{ value: string | null; projects: string; completed: string; premium: string }>(
      `SELECT ${expression} AS value, count(*) AS projects,
              count(*) FILTER (WHERE l.completed_at IS NOT NULL) AS completed,
              count(*) FILTER (WHERE p.premium_ever_activated) AS premium
         FROM project p
         LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
         LEFT JOIN analytics_project_profile a ON a.project_id = p.project_id
        WHERE p.created_at >= $1 AND p.created_at < $2
        GROUP BY 1 ORDER BY count(*) DESC`,
      [range.from, range.to],
    );
    return rows
      .map((r) => ({ value: r.value ?? "unknown", projects: Number(r.projects), completed: Number(r.completed), premiumActivated: Number(r.premium) }))
      .filter((r) => r.projects >= MIN_SEGMENT_SIZE);
  };
  // Sequential on purpose: one connection, one query at a time (concurrent queries on a shared
  // connection would interleave).
  const primaryGoal = await dimension("a.primary_goal");
  const entryMode = await dimension("a.entry_mode");
  const businessType = await dimension("a.business_type");
  const destinationStatus = await dimension("a.destination_status");
  const market = await dimension("unnest(CASE WHEN a.target_markets = '{}' THEN ARRAY[NULL]::text[] ELSE a.target_markets END)");
  const capability = await dimension("unnest(CASE WHEN a.expected_capabilities = '{}' THEN ARRAY[NULL]::text[] ELSE a.expected_capabilities END)");
  return { minimumSegmentSize: MIN_SEGMENT_SIZE, primaryGoal, entryMode, businessType, destinationStatus, market, capability };
}

/** Operational health: email, jobs, integrations, rate limiting, retention and pending Premium. */
export async function operationalMetrics(db: Db, range: AnalyticsRange, now: Date) {
  const email = await db.query(
    `SELECT template, status, count(*) AS deliveries, round(avg(attempts), 2) AS avg_attempts
       FROM email_delivery WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2 ORDER BY 1, 2`,
    [range.from, range.to],
  );
  const jobs = await db.query(
    `SELECT job_name,
            max(started_at) AS last_run_at,
            max(started_at) FILTER (WHERE status = 'SUCCEEDED') AS last_success_at,
            count(*) FILTER (WHERE status = 'FAILED' AND started_at >= $1) AS failures,
            count(*) FILTER (WHERE status = 'ABANDONED' AND started_at >= $1) AS abandoned
       FROM job_run GROUP BY job_name ORDER BY job_name`,
    [range.from],
  );
  const integrations = await db.query(
    `SELECT destination, status, count(*) AS deliveries, min(created_at) FILTER (WHERE status = 'PENDING') AS oldest_pending
       FROM integration_delivery GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const rateLimits = await db.query(
    `SELECT policy, count(*) AS windows_over_limit, sum(hits - max_hits) AS refused
       FROM rate_limit_counter WHERE hits > max_hits AND window_start >= $1::timestamptz - interval '24 hours'
      GROUP BY policy ORDER BY 2 DESC`,
    [now],
  );
  const retention = await db.query<{ purged: string; due: string; blocked_by_request: string; oldest_pending_days: string | null }>(
    `SELECT (SELECT count(*) FROM retention_purge_record WHERE purged_at >= $1 AND purged_at < $2) AS purged,
            (SELECT count(*) FROM fa_project_lifecycle l JOIN project p ON p.project_id = l.project_id
              WHERE l.retention_until <= $3 AND p.assessment_state IN ('IN_PROGRESS', 'COMPLETED_LOCKED', 'EXPIRED') AND NOT p.premium_ever_activated) AS due,
            (SELECT count(*) FROM fa_project_lifecycle l JOIN project p ON p.project_id = l.project_id
               JOIN premium_activation_request r ON r.project_id = p.project_id AND r.status = 'REQUESTED'
              WHERE l.retention_until <= $3 AND NOT p.premium_ever_activated) AS blocked_by_request,
            (SELECT round(max(EXTRACT(EPOCH FROM ($3::timestamptz - requested_at)) / 86400.0), 1)
               FROM premium_activation_request WHERE status = 'REQUESTED') AS oldest_pending_days`,
    [range.from, range.to, now],
  );
  const r = retention.rows[0];
  return {
    email: email.rows,
    jobs: jobs.rows,
    integrations: integrations.rows,
    rateLimits: rateLimits.rows,
    retention: {
      purgedInRange: Number(r?.purged ?? 0),
      dueForPurge: Number(r?.due ?? 0),
      // Pending Premium requests currently keep a project out of temporary retention: a deterministic
      // timeout for them is an open decision, so the count and age are reported here.
      heldByPendingPremiumRequest: Number(r?.blocked_by_request ?? 0),
      oldestPendingPremiumRequestDays: r?.oldest_pending_days === null || r?.oldest_pending_days === undefined ? null : Number(r.oldest_pending_days),
    },
  };
}
