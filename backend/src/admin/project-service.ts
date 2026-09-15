import { Db } from "../db/database";
import { lifecyclePolicyOf } from "../fa/services/access-lifecycle";
import { BundleStore } from "../fa/services/bundle-store";
import { FaError } from "../fa/services/errors";
import { operationHubAccess } from "../premium/operation-hub";
import { getPremiumStatus } from "../premium/premium-service";

/**
 * Read models for the Admin/Supervisor Control Center. Everything here is read-only: the frozen
 * Snapshot, Internal Assessment, findings and answers are returned exactly as stored; there is no
 * write path to client answers or historical records anywhere in the Admin API.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function searchProjects(db: Db, rawQuery: string) {
  const term = rawQuery.trim();
  if (term.length < 2 || term.length > 200) throw new FaError("INVALID_INPUT", "search needs between 2 and 200 characters", { fields: ["q"] });
  const byId = UUID.test(term);
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { rows } = await db.query(
    `SELECT p.project_id, p.assessment_state, p.premium_ever_activated, p.precision_state, p.question_bank_version, p.created_at,
            c.company_id, c.name AS company_name, pe.person_id, pe.first_name, pe.last_name, pe.primary_email,
            l.completed_at, l.access_expires_at, l.retention_until, COALESCE(e.premium_access_active, false) AS premium_access_active
       FROM project p
       JOIN company c ON c.company_id = p.company_id
       JOIN person pe ON pe.person_id = p.created_by_person_id
       LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE ${byId ? "p.project_id = $1::uuid OR p.company_id = $1::uuid OR p.created_by_person_id = $1::uuid" : "c.name ILIKE $1 OR pe.primary_email ILIKE $1 OR (pe.first_name || ' ' || pe.last_name) ILIKE $1"}
      ORDER BY p.created_at DESC
      LIMIT 50`,
    [byId ? term : like],
  );
  return rows;
}

async function requireProject(db: Db, projectId: string): Promise<{ question_bank_version: string; premium_ever_activated: boolean; assessment_state: string }> {
  const { rows } = await db.query<{ question_bank_version: string; premium_ever_activated: boolean; assessment_state: string }>(
    "SELECT question_bank_version, premium_ever_activated, assessment_state FROM project WHERE project_id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new FaError("NOT_FOUND", "project not found");
  return row;
}

export async function projectOverview(db: Db, bundles: BundleStore, projectId: string, now: Date) {
  const { rows } = await db.query<Record<string, unknown> & { question_bank_version: string; premium_ever_activated: boolean; access_expires_at: Date | null; access_max_until: Date | null; retention_until: Date | null; assessment_state: string }>(
    `SELECT p.project_id, p.assessment_state, p.trust_state, p.question_bank_version, p.rules_engine_version, p.snapshot_template_version,
            p.last_completed_step, p.extension_requested, p.premium_ever_activated, p.premium_first_activated_at, p.precision_state,
            p.precision_started_at, p.created_at, p.updated_at,
            c.company_id, c.name AS company_name, c.website AS company_website,
            pe.person_id, pe.first_name, pe.last_name, pe.preferred_name, pe.primary_email, pe.interface_language,
            pe.preferred_interaction_language, pe.preferred_deliverable_language,
            l.identity_completed_at, l.last_activity_at, l.last_answered_question_id, l.access_window_started_at, l.access_expires_at,
            l.access_max_until, l.retention_until, l.retention_basis, l.reminder_day10_sent_at, l.recovery_email_sent_at,
            l.access_expiry_recorded_for, l.completed_at,
            COALESCE(e.premium_access_active, false) AS premium_access_active, e.effective_from, e.effective_until
       FROM project p
       JOIN company c ON c.company_id = p.company_id
       JOIN person pe ON pe.person_id = p.created_by_person_id
       LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new FaError("NOT_FOUND", "project not found");
  const bundle = await bundles.byVersion(row.question_bank_version).catch(() => null);
  const { policy, source } = lifecyclePolicyOf(bundle ?? {});
  const legal = await db.query(
    "SELECT document, document_url, question_bank_version, interface_language, accepted_at FROM legal_acceptance WHERE project_id = $1 ORDER BY document",
    [projectId],
  );
  const purge = await db.query("SELECT purged_at, previous_state, retention_until, retention_basis, purge_scope, deleted_rows, person_anonymized, company_anonymized FROM retention_purge_record WHERE project_id = $1", [projectId]);
  const t = now.getTime();
  return {
    project: row,
    derived: {
      accessOpen: row.assessment_state === "IN_PROGRESS" && (!row.access_expires_at || row.access_expires_at.getTime() > t),
      recoverable: row.assessment_state === "IN_PROGRESS" && !!row.access_expires_at && row.access_expires_at.getTime() <= t && !!row.access_max_until && row.access_max_until.getTime() > t,
      temporaryRetentionApplies: !row.premium_ever_activated,
      retentionElapsed: !row.premium_ever_activated && !!row.retention_until && row.retention_until.getTime() <= t,
    },
    lifecyclePolicy: { source, ...policy },
    legalAcceptances: legal.rows,
    purge: purge.rows[0] ?? null,
  };
}

export async function projectAnswers(db: Db, bundles: BundleStore, projectId: string) {
  const project = await requireProject(db, projectId);
  const bundle = await bundles.byVersion(project.question_bank_version);
  const { rows } = await db.query<{ field_key: string; value: unknown; value_type: string; answered_at: Date; versions: number }>(
    `SELECT a.field_key, a.value, a.value_type, a.answered_at,
            (SELECT count(*)::int FROM answer a2 WHERE a2.project_id = a.project_id AND a2.field_key = a.field_key) AS versions
       FROM answer a WHERE a.project_id = $1 AND a.superseded_by IS NULL`,
    [projectId],
  );
  const byKey = new Map(rows.map((r) => [r.field_key, r]));
  const questions = new Map(bundle.questions.map((q) => [q.id, q]));
  return {
    questionBankVersion: project.question_bank_version,
    assessmentState: project.assessment_state,
    readOnly: true,
    steps: bundle.steps
      .filter((s) => s.kind === "questions")
      .map((step) => ({
        stepId: step.id,
        title: step.copy.en.title,
        questions: step.question_ids.map((id) => {
          const q = questions.get(id);
          const answer = q ? byKey.get(q.field_key) : undefined;
          return {
            questionId: id,
            fieldKey: q?.field_key ?? null,
            type: q?.type ?? null,
            title: q?.copy.en.title ?? id,
            answered: answer !== undefined,
            value: answer?.value ?? null,
            answeredAt: answer?.answered_at ?? null,
            versions: answer?.versions ?? 0,
          };
        }),
      })),
  };
}

export async function projectSnapshot(db: Db, projectId: string) {
  await requireProject(db, projectId);
  const { rows } = await db.query(
    "SELECT snapshot_id, generated_at, rules_engine_version, snapshot_template_version, content FROM snapshot WHERE project_id = $1",
    [projectId],
  );
  return { snapshot: rows[0] ?? null, immutable: true };
}

export async function projectInternalAssessment(db: Db, projectId: string) {
  await requireProject(db, projectId);
  const internal = await db.query<{ content: { precision_focus?: unknown } }>(
    "SELECT internal_assessment_id, generated_at, rules_engine_version, snapshot_template_version, content FROM internal_assessment WHERE project_id = $1",
    [projectId],
  );
  const findings = await db.query(
    `SELECT f.area_id, m.name AS area_name, f.status, f.signal_strength, f.internal_signal, f.reason_client, f.reason_internal, f.rule_triggered,
            f.evidence, f.signals, f.panel_rank, f.included_in_snapshot, f.rules_engine_version
       FROM finding f JOIN rules_matrix_category m ON m.category_id = f.area_id
      WHERE f.project_id = $1 ORDER BY f.area_id`,
    [projectId],
  );
  const alignment = await db.query("SELECT alignment, tension_area_id, tension_reason, tests_matched, rule_triggered FROM priority_alignment WHERE project_id = $1", [projectId]);
  const capabilities = await db.query(
    `SELECT r.category_id, t.name AS category_name, r.rank, r.included_in_snapshot, r.source_area_ids, r.ranking_factors
       FROM capability_rank r JOIN capability_taxonomy_category t ON t.category_id = r.category_id
      WHERE r.project_id = $1 ORDER BY r.rank`,
    [projectId],
  );
  const handoff = await db.query(
    "SELECT package_id, generated_at, contract_version, source_snapshot_id, source_internal_assessment_id, generated_by_event_id FROM precision_handoff_package WHERE project_id = $1",
    [projectId],
  );
  const record = internal.rows[0] ?? null;
  return {
    internalAssessment: record,
    precisionFocus: record?.content?.precision_focus ?? [],
    findings: findings.rows,
    priorityAlignment: alignment.rows[0] ?? null,
    capabilities: capabilities.rows,
    handoffPackage: handoff.rows[0] ?? null,
    immutable: true,
  };
}

export async function projectPremium(db: Db, bundles: BundleStore, projectId: string) {
  await requireProject(db, projectId);
  const status = await getPremiumStatus(db, projectId, bundles);
  const subscriptions = await db.query(
    `SELECT subscription_id, status, current_period_start, current_period_end, cancel_at_period_end, cancellation_requested_at, ended_at, created_at
       FROM subscription WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  const events = await db.query("SELECT event_id, event_type, occurred_at, source, subscription_id FROM subscription_event WHERE project_id = $1 ORDER BY occurred_at", [projectId]);
  const requests = await db.query(
    "SELECT request_id, kind, status, terms_url, terms_accepted_at, checkout_adapter, requested_at, fulfilled_at FROM premium_activation_request WHERE project_id = $1 ORDER BY requested_at",
    [projectId],
  );
  const entitlement = await db.query("SELECT premium_access_active, effective_from, effective_until, updated_at FROM entitlement WHERE project_id = $1", [projectId]);
  const handoff = await db.query("SELECT package_id, generated_at, contract_version, generated_by_event_id FROM precision_handoff_package WHERE project_id = $1", [projectId]);
  return {
    status,
    entitlement: entitlement.rows[0] ?? null,
    subscriptions: subscriptions.rows,
    events: events.rows,
    activationRequests: requests.rows,
    handoffPackage: handoff.rows[0] ?? null,
    operationHub: await operationHubAccess(db, projectId),
  };
}

export async function projectLifecycle(db: Db, bundles: BundleStore, projectId: string, now: Date) {
  const project = await requireProject(db, projectId);
  const bundle = await bundles.byVersion(project.question_bank_version).catch(() => null);
  const { policy, source } = lifecyclePolicyOf(bundle ?? {});
  const lifecycle = await db.query("SELECT * FROM fa_project_lifecycle WHERE project_id = $1", [projectId]);
  const transitions = await db.query("SELECT from_state, to_state, trigger, occurred_at FROM assessment_state_transition WHERE project_id = $1 ORDER BY occurred_at", [projectId]);
  const extensions = await db.query("SELECT requested_days, reason, previous_expires_at, new_expires_at, was_expired, requested_at FROM fa_access_extension WHERE project_id = $1 ORDER BY requested_at", [projectId]);
  const deliveries = await db.query(
    `SELECT delivery_id, template, status, attempts, max_attempts, enqueued_by, next_attempt_at, created_at, sent_at, finished_at, cancel_reason, last_error
       FROM email_delivery WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  // Token metadata only — never hashes, never raw tokens.
  const tokens = await db.query("SELECT kind, email_verified, created_at, expires_at, revoked_at, last_used_at FROM project_access_token WHERE project_id = $1 ORDER BY created_at", [projectId]);
  const journey = await db.query(
    "SELECT event_type, occurred_at, step_id, question_id FROM fa_journey_event WHERE project_id = $1 ORDER BY occurred_at DESC LIMIT 100",
    [projectId],
  );
  const purge = await db.query("SELECT purged_at, previous_state, retention_until, retention_basis, purge_scope, deleted_rows, person_anonymized, company_anonymized FROM retention_purge_record WHERE project_id = $1", [projectId]);
  return {
    policy: { source, ...policy },
    lifecycle: lifecycle.rows[0] ?? null,
    transitions: transitions.rows,
    extensions: extensions.rows,
    emailDeliveries: deliveries.rows,
    privateLinks: tokens.rows.map((t) => ({ ...t, active: !t.revoked_at && new Date(t.expires_at as string).getTime() > now.getTime() })),
    journeyEvents: journey.rows,
    purge: purge.rows[0] ?? null,
  };
}

const DELIVERY_STATUSES = new Set(["PENDING", "SENDING", "SENT", "FAILED", "DEAD", "CANCELLED"]);

export async function listEmailDeliveries(db: Db, status: string | null) {
  const filter = status && DELIVERY_STATUSES.has(status) ? status : null;
  const { rows } = await db.query(
    `SELECT delivery_id, project_id, template, status, attempts, max_attempts, enqueued_by, next_attempt_at, created_at, sent_at, finished_at, cancel_reason, last_error
       FROM email_delivery WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 100`,
    [filter],
  );
  return rows;
}

export async function listJobRuns(db: Db) {
  const { rows } = await db.query("SELECT run_id, job_name, trigger, status, started_at, finished_at, stats, error FROM job_run ORDER BY started_at DESC LIMIT 100");
  return rows;
}

export async function listAuditEvents(db: Db, projectId: string | null) {
  const { rows } = await db.query(
    `SELECT a.audit_id, a.occurred_at, a.actor_type, u.auth_identity AS actor, a.action, a.outcome, a.target_type, a.target_id, a.project_id, a.request_id, a.details
       FROM admin_audit_event a LEFT JOIN admin_user u ON u.admin_user_id = a.actor_admin_user_id
      WHERE ($1::uuid IS NULL OR a.project_id = $1) ORDER BY a.occurred_at DESC LIMIT 200`,
    [projectId],
  );
  return rows;
}
