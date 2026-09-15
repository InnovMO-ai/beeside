import { Db } from "../db/database";
import type { QuestionBankBundle } from "../fa/engine/bundle-types";
import { fillTemplate } from "../fa/email/email-adapter";
import { recordJourneyEvent } from "../fa/services/analytics";
import { FaError } from "../fa/services/errors";
import { FaDeps, ProjectRow, findUsableToken, issueToken, loadProject, recordEmailEvent, revokeTokens } from "../fa/services/repository";
import { looksLikeAccessToken } from "../fa/services/tokens";
import { evaluateRules } from "../rules/engine";
import { validateRulesEngineBundle } from "../rules/validate-rules-bundle";
import { ClientSnapshotContent, composeClientSnapshot, composeInternalAssessment, localeOf } from "./compose";

/** Private Snapshot links stay usable for this long after generation (retention policy pending). */
export const SNAPSHOT_LINK_DAYS = 60;

export interface SnapshotView {
  snapshotId: string;
  generatedAt: string;
  content: ClientSnapshotContent;
}

/**
 * The COMPLETED_LOCKED transition (Technical Architecture v1.1 §10): one final evaluate() pass
 * produces findings, priority alignment, capability ranks, the client Snapshot and the Internal
 * Assessment inside the caller's transaction, before the project is locked. The database refuses
 * any of these rows once the project is locked and refuses a Snapshot without its Internal
 * Assessment (and vice versa) at commit.
 */
export async function generateAssessmentOutputs(
  tx: Db,
  deps: FaDeps,
  project: ProjectRow,
  questionBank: QuestionBankBundle,
  effectiveAnswers: ReadonlyMap<string, unknown>,
  now: Date,
): Promise<{ snapshotId: string }> {
  const pins = await tx.query<{ rules_engine_version: string; snapshot_template_version: string; last_name: string }>(
    `SELECT p.rules_engine_version, p.snapshot_template_version, pe.last_name
       FROM project p JOIN person pe ON pe.person_id = p.created_by_person_id WHERE p.project_id = $1`,
    [project.project_id],
  );
  const pin = pins.rows[0];
  if (!pin) throw new FaError("NOT_FOUND", "project not found");
  const rules = await deps.bundles.rulesByVersion(pin.rules_engine_version);
  const template = await deps.bundles.templateByVersion(pin.snapshot_template_version);
  if (validateRulesEngineBundle(rules).length > 0 || !rules.question_bank_versions.includes(project.question_bank_version)) {
    throw new FaError("NOT_READY", "the pinned rules engine cannot evaluate this question bank version");
  }

  const answerRows = await tx.query<{ answer_id: string; field_key: string }>(
    "SELECT answer_id, field_key FROM answer WHERE project_id = $1 AND superseded_by IS NULL",
    [project.project_id],
  );
  const answerIds = new Map(answerRows.rows.map((r) => [r.field_key, r.answer_id]));
  const evidence = new Map([...effectiveAnswers].map(([key, value]) => [key, { value, answerId: answerIds.get(key) ?? null }]));
  const evaluation = evaluateRules(rules, evidence, now);

  const input = {
    projectId: project.project_id,
    generatedAt: now,
    versions: { questionBank: project.question_bank_version, rulesEngine: pin.rules_engine_version, snapshotTemplate: pin.snapshot_template_version },
    company: { name: project.company_name, website: project.company_website },
    person: {
      firstName: project.first_name,
      lastName: pin.last_name,
      preferredName: project.preferred_name,
      deliverableLanguage: project.preferred_deliverable_language,
      interactionLanguage: project.preferred_interaction_language,
    },
    answers: effectiveAnswers,
    questionBank,
    rules,
    template,
    evaluation,
  };
  const client = composeClientSnapshot(input);
  const internal = composeInternalAssessment(input);
  const deliverable = localeOf(project.preferred_deliverable_language);

  for (const f of evaluation.findings) {
    await tx.query(
      `INSERT INTO finding (project_id, area_id, status, signal_strength, internal_signal, reason_client, evidence_field_keys,
         rule_triggered, reason_internal, evidence, signals, source_type, panel_rank, included_in_snapshot, rules_engine_version,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, 'DERIVED_BY_RULE', $12, $13, $14, $15, $15)`,
      [
        project.project_id,
        f.areaId,
        f.status,
        f.signalStrength,
        f.internalSignal,
        f.reasonClient?.[deliverable] ?? null,
        f.evidence.map((e) => e.fieldKey),
        f.ruleTriggered,
        f.reasonInternal,
        JSON.stringify(f.evidence),
        JSON.stringify(f.signals),
        f.panelRank,
        f.includedInSnapshot,
        pin.rules_engine_version,
        now,
      ],
    );
  }

  const alignment = evaluation.priorityAlignment;
  await tx.query(
    `INSERT INTO priority_alignment (project_id, alignment, tension_area_id, tension_reason, tests_matched, rule_triggered, rules_engine_version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [project.project_id, alignment.alignment, alignment.tensionAreaId, alignment.reason?.[deliverable] ?? null, alignment.testsMatched, alignment.ruleTriggered, pin.rules_engine_version, now],
  );

  for (const c of evaluation.capabilities) {
    await tx.query(
      `INSERT INTO capability_rank (project_id, category_id, rank, included_in_snapshot, source_area_ids, ranking_factors, rules_engine_version)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [project.project_id, c.categoryId, c.rank, c.includedInSnapshot, c.sourceAreaIds, JSON.stringify(c.factors), pin.rules_engine_version],
    );
  }

  const snapshot = await tx.query<{ snapshot_id: string }>(
    `INSERT INTO snapshot (project_id, generated_at, rules_engine_version, snapshot_template_version, content)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING snapshot_id`,
    [project.project_id, now, pin.rules_engine_version, pin.snapshot_template_version, JSON.stringify(client)],
  );
  await tx.query(
    `INSERT INTO internal_assessment (project_id, generated_at, rules_engine_version, snapshot_template_version, content)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [project.project_id, now, pin.rules_engine_version, pin.snapshot_template_version, JSON.stringify(internal)],
  );

  await recordJourneyEvent(tx, {
    eventType: "snapshot_generated",
    projectId: project.project_id,
    questionBankVersion: project.question_bank_version,
    interfaceLanguage: project.interface_language,
    properties: {
      defined: evaluation.panelCounts.DEFINED,
      needs_attention: evaluation.panelCounts.NEEDS_ATTENTION,
      resolve_early: evaluation.panelCounts.CRITICAL_GAP,
      capabilities_shown: evaluation.capabilities.filter((c) => c.includedInSnapshot).length,
      tension_detected: alignment.alignment === "TENSION_DETECTED",
    },
  });
  return { snapshotId: snapshot.rows[0]?.snapshot_id ?? "" };
}

/** Snapshot delivery (Master Build Guide Appendix B5) with a private link, via the email adapter. */
export async function sendSnapshotEmail(tx: Db, deps: FaDeps, projectId: string, now: Date): Promise<void> {
  const project = await loadProject(tx, projectId);
  if (!project) return;
  const pins = await tx.query<{ snapshot_template_version: string }>("SELECT snapshot_template_version FROM project WHERE project_id = $1", [projectId]);
  const template = await deps.bundles.templateByVersion(pins.rows[0]?.snapshot_template_version ?? "");
  const locale = localeOf(project.preferred_deliverable_language);
  const copy = template.emails.snapshot_ready?.copy[locale];
  if (!copy) throw new FaError("NOT_READY", "the Snapshot delivery email is not configured");

  await revokeTokens(tx, projectId, "RESUME", now);
  const token = await issueToken(tx, projectId, "RESUME", true, new Date(now.getTime() + SNAPSHOT_LINK_DAYS * 86_400_000));
  const variables = { preferred_name: project.preferred_name ?? project.first_name };
  const result = await deps.email.send({
    template: "snapshot_ready",
    to: project.primary_email,
    locale,
    subject: fillTemplate(copy.subject, variables),
    body: fillTemplate(copy.body, variables),
    ctaLabel: fillTemplate(copy.cta, variables),
    ctaUrl: `${deps.config.appBaseUrl.replace(/\/$/, "")}/resume/${token}`,
    projectId,
  });
  await recordEmailEvent(tx, projectId, "snapshot_ready", project.primary_email, deps.email.name, result.providerReference, now);
  await recordJourneyEvent(tx, { eventType: "snapshot_email_sent", projectId, questionBankVersion: project.question_bank_version });
}

async function loadSnapshot(db: Db, projectId: string): Promise<SnapshotView> {
  const { rows } = await db.query<{ snapshot_id: string; generated_at: Date; content: ClientSnapshotContent }>(
    "SELECT snapshot_id, generated_at, content FROM snapshot WHERE project_id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new FaError("NOT_FOUND", "this Snapshot is not available");
  return { snapshotId: row.snapshot_id, generatedAt: row.generated_at.toISOString(), content: row.content };
}

/** The respondent's own Snapshot, from their working session. */
export async function getSessionSnapshot(deps: FaDeps, project: ProjectRow): Promise<SnapshotView> {
  if (project.assessment_state !== "COMPLETED_LOCKED") throw new FaError("INCOMPLETE", "the First Assessment is not complete yet");
  return loadSnapshot(deps.db, project.project_id);
}

/** The Snapshot behind a verified private link (the delivery email or a re-requested link). */
export async function openSnapshotFromLink(deps: FaDeps, rawToken: unknown): Promise<SnapshotView> {
  const now = deps.config.now();
  const token = looksLikeAccessToken(rawToken) ? await findUsableToken(deps.db, rawToken, "RESUME", now) : null;
  const project = token ? await loadProject(deps.db, token.project_id) : null;
  if (!project || project.assessment_state !== "COMPLETED_LOCKED") throw new FaError("NOT_FOUND", "this Snapshot is not available");
  return loadSnapshot(deps.db, project.project_id);
}
