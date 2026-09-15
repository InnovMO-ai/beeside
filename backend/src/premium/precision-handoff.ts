import type { PrecisionHandoffPackage } from "@beeside/canonical-fields";
import { Db } from "../db/database";
import { BundleStore } from "../fa/services/bundle-store";
import { FaError } from "../fa/services/errors";
import { getFirstAssessmentPrecisionContext } from "../precision-context/first-assessment-context";

export const PRECISION_HANDOFF_CONTRACT_VERSION = 1;

export const PRECISION_START_INSTRUCTION =
  "Do not restart discovery. Begin by acknowledging what is already known, confirm only what needs validation, update anything that has changed, and focus first on unresolved high-impact questions.";

interface InternalContent {
  executive_summary: Record<string, string>;
  narrative: Record<string, unknown>;
  profile: Record<string, unknown>;
  declared_priority: Record<string, unknown>;
  priority_alignment: unknown;
  findings: unknown[];
  candidate_services: unknown[];
  strategic_signals: unknown[];
  capabilities: unknown[];
  constraints: Record<string, unknown>;
  stop_go_criteria: string[];
  next_decision: string | null;
  primary_concern: string | null;
  volumetrics: unknown[];
  respondent: Record<string, unknown>;
  not_sure_answers: string[];
  precision_focus: unknown[];
}

/**
 * Materializes the handoff package from the already-frozen Snapshot and Internal Assessment of a
 * locked First Assessment plus its canonical context — never from a re-evaluation of answers.
 */
export async function buildPrecisionHandoffPackage(
  tx: Db,
  bundles: BundleStore,
  projectId: string,
  now: Date,
): Promise<{ content: PrecisionHandoffPackage; sourceSnapshotId: string; sourceInternalAssessmentId: string }> {
  const snapshot = await tx.query<{ snapshot_id: string }>("SELECT snapshot_id FROM snapshot WHERE project_id = $1", [projectId]);
  const internal = await tx.query<{ internal_assessment_id: string; content: InternalContent }>(
    "SELECT internal_assessment_id, content FROM internal_assessment WHERE project_id = $1",
    [projectId],
  );
  const snapshotRow = snapshot.rows[0];
  const internalRow = internal.rows[0];
  if (!snapshotRow || !internalRow) throw new FaError("NOT_APPLICABLE", "the First Assessment has no frozen Snapshot to hand off");
  const context = await getFirstAssessmentPrecisionContext(tx, bundles, projectId);
  if (!context || context.assessment.status !== "COMPLETED_LOCKED") throw new FaError("NOT_APPLICABLE", "only a locked First Assessment can be handed off");
  const ia = internalRow.content;

  const content: PrecisionHandoffPackage = {
    contractVersion: PRECISION_HANDOFF_CONTRACT_VERSION,
    generatedAt: now.toISOString(),
    projectId: context.projectId,
    personId: context.personId,
    companyId: context.companyId,
    source: {
      snapshotId: snapshotRow.snapshot_id,
      internalAssessmentId: internalRow.internal_assessment_id,
      questionBankVersion: context.assessment.questionBankVersion,
      rulesEngineVersion: context.assessment.rulesEngineVersion,
      snapshotTemplateVersion: context.assessment.snapshotTemplateVersion,
      firstAssessmentCompletedAt: context.assessment.completedAt,
    },
    instruction: PRECISION_START_INSTRUCTION,
    knownInformation: {
      source: "DECLARED_BY_USER",
      structuredFieldKeys: Object.keys(context.structuredAnswers).sort(),
      openTextFieldKeys: Object.keys(context.openTextAnswers).sort(),
    },
    executiveSummary: ia.executive_summary,
    userNarrative: ia.narrative,
    businessProfile: ia.profile,
    declaredPriority: ia.declared_priority,
    priorityAlignment: ia.priority_alignment,
    findings: ia.findings,
    candidateServices: ia.candidate_services,
    strategicSignals: ia.strategic_signals,
    relevantCapabilities: ia.capabilities,
    constraints: ia.constraints,
    stopGoCriteria: ia.stop_go_criteria,
    nextDecision: ia.next_decision,
    primaryConcern: ia.primary_concern,
    volumetrics: ia.volumetrics,
    ownership: { ...ia.respondent, companyName: context.company.name },
    openQuestions: { notSureFieldKeys: ia.not_sure_answers },
    precisionFocus: ia.precision_focus,
    guardrails: {
      findingsAreNotContractedServices: true,
      clientProviderDirectContact: "not_authorized",
      precisionNamespace: "precision.*",
      regeneratedOnReactivation: false,
    },
  };
  return { content, sourceSnapshotId: snapshotRow.snapshot_id, sourceInternalAssessmentId: internalRow.internal_assessment_id };
}

/**
 * What Precision starts from: the single frozen handoff package plus the live canonical First
 * Assessment context (same person, company and project ids) and any precision.* data Precision has
 * added since. Nothing is copied into a Precision-owned clone of First Assessment.
 */
export async function getPrecisionStartContext(db: Db, bundles: BundleStore, projectId: string) {
  const project = await db.query<{ precision_state: string }>("SELECT precision_state FROM project WHERE project_id = $1", [projectId]);
  if (!project.rows[0]) throw new FaError("NOT_FOUND", "project not found");
  if (project.rows[0].precision_state !== "STARTED") throw new FaError("NOT_APPLICABLE", "Precision has not started for this project");
  const pkg = await db.query<{ package_id: string; generated_at: Date; content: PrecisionHandoffPackage }>(
    "SELECT package_id, generated_at, content FROM precision_handoff_package WHERE project_id = $1",
    [projectId],
  );
  const firstAssessment = await getFirstAssessmentPrecisionContext(db, bundles, projectId);
  const precisionAnswers = await db.query<{ field_key: string; value: unknown; answered_at: Date }>(
    "SELECT field_key, value, answered_at FROM answer WHERE project_id = $1 AND superseded_by IS NULL AND field_key LIKE 'precision.%' ORDER BY field_key",
    [projectId],
  );
  const row = pkg.rows[0];
  if (!row || !firstAssessment) throw new FaError("NOT_FOUND", "the Precision handoff package is missing");
  return {
    handoffPackage: { packageId: row.package_id, generatedAt: row.generated_at.toISOString(), content: row.content },
    firstAssessment,
    precisionAnswers: precisionAnswers.rows.map((a) => ({ fieldKey: a.field_key, value: a.value, answeredAt: a.answered_at.toISOString() })),
  };
}
