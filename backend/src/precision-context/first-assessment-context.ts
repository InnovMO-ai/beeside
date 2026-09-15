import {
  getFieldDefinition,
  type FirstAssessmentAnswer,
  type FirstAssessmentPrecisionContext,
  type FirstAssessmentStatus,
} from "@beeside/canonical-fields";
import { Db } from "../db/database";
import { computeJourney } from "../fa/engine/journey";
import { isNotSureValue } from "../fa/engine/values";
import { BundleStore } from "../fa/services/bundle-store";

interface ContextRow {
  project_id: string;
  person_id: string;
  company_id: string;
  assessment_state: FirstAssessmentStatus;
  question_bank_version: string;
  rules_engine_version: string;
  snapshot_template_version: string;
  last_completed_step: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  preferred_interaction_language: string;
  preferred_deliverable_language: string;
  company_name: string;
  company_website: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * FA → Precision logical contract (Handoff v1 §20). Assembled on read from the canonical tables
 * and the project's pinned question bank; only answers that are applicable in the final journey
 * are included. Nothing is copied into a Precision table: Precision consumes FA, it does not clone it.
 */
export async function getFirstAssessmentPrecisionContext(
  db: Db,
  bundles: BundleStore,
  projectId: string,
): Promise<FirstAssessmentPrecisionContext | null> {
  const { rows } = await db.query<ContextRow>(
    `SELECT p.project_id, pe.person_id, p.company_id, p.assessment_state, p.question_bank_version, p.rules_engine_version,
            p.snapshot_template_version, p.last_completed_step, pe.first_name, pe.last_name, pe.preferred_name,
            pe.preferred_interaction_language, pe.preferred_deliverable_language, c.name AS company_name,
            c.website AS company_website, l.identity_completed_at AS started_at, l.completed_at
       FROM project p
       JOIN person pe ON pe.person_id = p.created_by_person_id
       JOIN company c ON c.company_id = p.company_id
       LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
      WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;

  const bundle = await bundles.byVersion(row.question_bank_version);
  const answerRows = await db.query<{ field_key: string; value: unknown; answered_at: Date }>(
    "SELECT field_key, value, answered_at FROM answer WHERE project_id = $1 AND superseded_by IS NULL",
    [projectId],
  );
  const stored = new Map<string, unknown>(answerRows.rows.map((a) => [a.field_key, a.value]));
  const answeredAt = new Map(answerRows.rows.map((a) => [a.field_key, a.answered_at]));
  stored.set("fa.preferences.interaction_language", row.preferred_interaction_language);
  stored.set("fa.preferences.deliverable_language", row.preferred_deliverable_language);
  if (row.preferred_name) stored.set("fa.preferences.preferred_name", row.preferred_name);

  const journey = computeJourney(bundle, stored, row.last_completed_step);
  const structuredAnswers: Record<string, FirstAssessmentAnswer> = {};
  const openTextAnswers: Record<string, FirstAssessmentAnswer> = {};
  const notSureFieldKeys: string[] = [];
  for (const question of bundle.questions) {
    if (!journey.effectiveAnswers.has(question.field_key)) continue;
    const def = getFieldDefinition(question.field_key);
    if (!def || def.binding) continue; // person-bound preferences are exposed in `person`
    const value = journey.effectiveAnswers.get(question.field_key);
    const entry: FirstAssessmentAnswer = {
      fieldKey: question.field_key,
      value,
      questionId: question.id,
      answeredAt: (answeredAt.get(question.field_key) ?? new Date(0)).toISOString(),
      source: "DECLARED_BY_USER",
    };
    (def.openText ? openTextAnswers : structuredAnswers)[question.field_key] = entry;
    if (isNotSureValue(value)) notSureFieldKeys.push(question.field_key);
  }
  const effective = (key: string) => journey.effectiveAnswers.get(key);

  // Sequential on purpose: a Db may be a single connection (one transaction), never parallel.
  const findings = await db.query<{ area_id: number; status: string; signal_strength: string; evidence_field_keys: string[] }>(
    "SELECT area_id, status, signal_strength, evidence_field_keys FROM finding WHERE project_id = $1 ORDER BY area_id",
    [projectId],
  );
  const capabilities = await db.query<{ category_id: number; rank: number; included_in_snapshot: boolean }>(
    "SELECT category_id, rank, included_in_snapshot FROM capability_rank WHERE project_id = $1 ORDER BY rank",
    [projectId],
  );
  const snapshot = await db.query<{ snapshot_id: string; generated_at: Date; snapshot_template_version: string }>(
    "SELECT snapshot_id, generated_at, snapshot_template_version FROM snapshot WHERE project_id = $1",
    [projectId],
  );
  const snap = snapshot.rows[0];
  const targetMarkets = effective("fa.project.target_markets");

  return {
    contractVersion: 1,
    projectId: row.project_id,
    personId: row.person_id,
    companyId: row.company_id,
    person: {
      firstName: row.first_name,
      lastName: row.last_name,
      preferredName: row.preferred_name,
      interactionLanguage: row.preferred_interaction_language,
      deliverableLanguage: row.preferred_deliverable_language,
    },
    company: { name: row.company_name, website: row.company_website },
    targetMarkets: Array.isArray(targetMarkets) ? targetMarkets.map(String) : [],
    targetLocationDetail: str(effective("fa.project.target_location_detail")),
    industry: str(effective("fa.business.type")),
    projectObjective: str(effective("fa.goal.primary_goal")),
    timing: {
      launchTimingStatus: str(effective("fa.goal.launch_timing_status")),
      launchTarget: effective("fa.goal.launch_target") ?? null,
      timingDriver: str(effective("fa.goal.timing_driver")),
    },
    declaredPriority: {
      priorityKnown: str(effective("fa.priority.priority_known")),
      clientPriority: str(effective("fa.priority.client_priority")),
      timing: str(effective("fa.priority.timing")),
      reason: str(effective("fa.priority.reason")),
    },
    structuredAnswers,
    openTextAnswers,
    notSureFieldKeys,
    assessment: {
      status: row.assessment_state,
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      questionBankVersion: row.question_bank_version,
      rulesEngineVersion: row.rules_engine_version,
      snapshotTemplateVersion: row.snapshot_template_version,
    },
    findings: findings.rows.map((f) => ({
      areaId: f.area_id,
      status: f.status,
      signalStrength: f.signal_strength,
      evidenceFieldKeys: f.evidence_field_keys,
    })),
    relevantCapabilities: capabilities.rows.map((c) => ({ categoryId: c.category_id, rank: c.rank, includedInSnapshot: c.included_in_snapshot })),
    snapshot: snap ? { snapshotId: snap.snapshot_id, generatedAt: snap.generated_at.toISOString(), snapshotTemplateVersion: snap.snapshot_template_version } : null,
  };
}
