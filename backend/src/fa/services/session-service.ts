import { randomUUID } from "node:crypto";
import { getFieldDefinition, type FieldBinding } from "@beeside/canonical-fields";
import { Db } from "../../db/database";
import { QuestionBankBundle, QuestionDef } from "../engine/bundle-types";
import { computeJourney, dynamicOptionValues } from "../engine/journey";
import { isNotSureValue, validateAnswerValue } from "../engine/values";
import { recordJourneyEvent } from "./analytics";
import { upsertProjectProfile } from "../../analytics/project-profile";
import { FaError } from "./errors";
import { startProject } from "./project-factory";
import { AssessmentState, FaDeps, ProjectRow, TokenRow, findUsableToken, issueToken, loadProject, loadStoredAnswers } from "./repository";
import { looksLikeAccessToken } from "./tokens";
import { enqueueSnapshotEmail, generateAssessmentOutputs } from "../../snapshot/snapshot-service";

export interface SessionContext {
  token: TokenRow;
  project: ProjectRow;
  bundle: QuestionBankBundle;
}

export interface SessionView {
  questionBankVersion: string;
  status: AssessmentState;
  currentStepId: string | null;
  lastCompletedStepId: string | null;
  steps: Array<{ id: string; applicable: boolean; confirmed: boolean; missingRequired: string[]; questionIds: string[] }>;
  /** Current effective answers of applicable questions, by question id. */
  answers: Record<string, unknown>;
  /** Allowed values for questions whose options come from an earlier answer. */
  dynamicOptions: Record<string, string[]>;
  finishLaterAvailable: boolean;
  anotherProjectInMind: string | null;
  accessUntil: string | null;
  interfaceLanguage: string;
}

const BINDING_COLUMNS: Partial<Record<FieldBinding, string>> = {
  "person.preferred_name": "preferred_name",
  "person.preferred_interaction_language": "preferred_interaction_language",
  "person.preferred_deliverable_language": "preferred_deliverable_language",
};

export async function authenticateSession(deps: FaDeps, rawToken: string | null): Promise<SessionContext> {
  if (!looksLikeAccessToken(rawToken)) throw new FaError("UNAUTHENTICATED", "a valid session is required");
  const now = deps.config.now();
  const token = await findUsableToken(deps.db, rawToken, "SESSION", now);
  if (!token) throw new FaError("UNAUTHENTICATED", "a valid session is required");
  const project = await loadProject(deps.db, token.project_id);
  if (!project || project.assessment_state === "EXPIRED" || project.assessment_state === "DELETED" || project.assessment_state === "DRAFT") {
    throw new FaError("UNAUTHENTICATED", "a valid session is required");
  }
  if (project.assessment_state === "IN_PROGRESS" && project.access_expires_at && project.access_expires_at.getTime() <= now.getTime()) {
    throw new FaError("ACCESS_EXPIRED", "this First Assessment is no longer active");
  }
  return { token, project, bundle: await deps.bundles.byVersion(project.question_bank_version) };
}

export async function buildSessionView(db: Db, project: ProjectRow, bundle: QuestionBankBundle): Promise<SessionView> {
  const stored = await loadStoredAnswers(db, project);
  const journey = computeJourney(bundle, stored, project.last_completed_step);
  const lastIndex = project.last_completed_step ? bundle.steps.findIndex((s) => s.id === project.last_completed_step) : -1;
  const answers: Record<string, unknown> = {};
  const dynamicOptions: Record<string, string[]> = {};
  for (const question of bundle.questions) {
    if (!journey.applicableQuestionIds.has(question.id)) continue;
    if (journey.effectiveAnswers.has(question.field_key)) answers[question.id] = journey.effectiveAnswers.get(question.field_key);
    if (question.options_from) dynamicOptions[question.id] = dynamicOptionValues(question, journey.effectiveAnswers);
  }
  const another = journey.effectiveAnswers.get("fa.project.another_project_in_mind");
  return {
    questionBankVersion: project.question_bank_version,
    status: project.assessment_state,
    currentStepId: project.assessment_state === "IN_PROGRESS" ? journey.currentStepId : null,
    lastCompletedStepId: project.last_completed_step,
    steps: journey.steps.map((s) => ({
      id: s.step.id,
      applicable: s.applicable,
      confirmed: s.index <= lastIndex && s.missingRequired.length === 0,
      missingRequired: s.missingRequired,
      questionIds: s.questions.filter((q) => q.applicable).map((q) => q.question.id),
    })),
    answers,
    dynamicOptions,
    finishLaterAvailable: project.assessment_state === "IN_PROGRESS",
    anotherProjectInMind: typeof another === "string" ? another : null,
    accessUntil: project.access_expires_at ? project.access_expires_at.toISOString() : null,
    interfaceLanguage: project.interface_language,
  };
}

function stepOfQuestion(bundle: QuestionBankBundle, questionId: string): string | null {
  return bundle.steps.find((s) => s.question_ids.includes(questionId))?.id ?? null;
}

async function writeAnswer(tx: Db, project: ProjectRow, question: QuestionDef, value: unknown): Promise<{ changed: boolean; hadPrevious: boolean }> {
  const json = JSON.stringify(value);
  const current = await tx.query<{ answer_id: string; same: boolean; is_null: boolean }>(
    `SELECT answer_id, value = $3::jsonb AS same, jsonb_typeof(value) = 'null' AS is_null
       FROM answer WHERE project_id = $1 AND field_key = $2 AND superseded_by IS NULL FOR UPDATE`,
    [project.project_id, question.field_key, json],
  );
  const row = current.rows[0];
  if (row?.same) return { changed: false, hadPrevious: true };
  if (!row && value === null) return { changed: false, hadPrevious: false };
  const answerId = randomUUID();
  if (row) await tx.query("UPDATE answer SET superseded_by = $2 WHERE answer_id = $1", [row.answer_id, answerId]);
  await tx.query(
    `INSERT INTO answer (answer_id, project_id, field_key, value, value_type, question_bank_version)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [answerId, project.project_id, question.field_key, json, question.type, project.question_bank_version],
  );
  return { changed: true, hadPrevious: row !== undefined && !row.is_null };
}

/** Autosave of one meaningful answer (Handoff v1 §17): validated, append-only, audited. */
export async function saveAnswer(deps: FaDeps, ctx: SessionContext, questionId: string, value: unknown): Promise<SessionView> {
  const question = ctx.bundle.questions.find((q) => q.id === questionId);
  if (!question) throw new FaError("NOT_FOUND", "question not found");
  const now = deps.config.now();

  return deps.db.transaction(async (tx) => {
    const project = await loadProject(tx, ctx.project.project_id, true);
    if (!project) throw new FaError("NOT_FOUND", "project not found");
    if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete and can no longer change");

    const stored = await loadStoredAnswers(tx, project);
    const journey = computeJourney(ctx.bundle, stored, project.last_completed_step);
    if (!journey.applicableQuestionIds.has(question.id)) throw new FaError("NOT_APPLICABLE", "this question does not apply right now");
    const result = validateAnswerValue(question, value, journey.effectiveAnswers);
    if (!result.ok) throw new FaError("INVALID_INPUT", result.error, { questionId: question.id });

    const binding = getFieldDefinition(question.field_key)?.binding;
    let changed: boolean;
    let hadPrevious: boolean;
    if (binding) {
      const column = BINDING_COLUMNS[binding];
      if (!column) throw new FaError("INVALID_INPUT", "this field cannot be changed here");
      hadPrevious = stored.has(question.field_key);
      changed = stored.get(question.field_key) !== result.value;
      if (changed) {
        await tx.query(`UPDATE person SET ${column} = $2, updated_at = $3 WHERE person_id = $1`, [
          project.created_by_person_id,
          result.value,
          now,
        ]);
      }
    } else {
      ({ changed, hadPrevious } = await writeAnswer(tx, project, question, result.value));
    }

    await tx.query(
      `UPDATE fa_project_lifecycle SET last_activity_at = $2, last_answered_question_id = $3, updated_at = $2 WHERE project_id = $1`,
      [project.project_id, now, question.id],
    );
    if (changed) {
      await recordJourneyEvent(tx, {
        eventType: "answer_saved",
        projectId: project.project_id,
        stepId: stepOfQuestion(ctx.bundle, question.id),
        questionId: question.id,
        fieldKey: question.field_key,
        questionBankVersion: project.question_bank_version,
        interfaceLanguage: project.interface_language,
        valueState: result.value === null ? "cleared" : isNotSureValue(result.value) ? "not_sure" : "answered",
        properties: { revised: hadPrevious },
      });
    }
    const refreshed = await loadProject(tx, project.project_id);
    if (!refreshed) throw new FaError("NOT_FOUND", "project not found");
    return buildSessionView(tx, refreshed, ctx.bundle);
  });
}

/**
 * Confirms a step. When the last applicable step is confirmed with every applicable required
 * answer present, the First Assessment becomes COMPLETED_LOCKED (no review screen; Snapshot is
 * generated by Phase 8 from this locked state).
 */
export async function completeStep(deps: FaDeps, ctx: SessionContext, stepId: string, durationMs: number | null): Promise<SessionView> {
  const now = deps.config.now();
  return deps.db.transaction(async (tx) => {
    const project = await loadProject(tx, ctx.project.project_id, true);
    if (!project) throw new FaError("NOT_FOUND", "project not found");
    if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete and can no longer change");

    const stored = await loadStoredAnswers(tx, project);
    const journey = computeJourney(ctx.bundle, stored, project.last_completed_step);
    const state = journey.steps.find((s) => s.step.id === stepId);
    if (!state) throw new FaError("NOT_FOUND", "step not found");
    if (!state.applicable) throw new FaError("NOT_APPLICABLE", "this step does not apply");
    const current = journey.steps.find((s) => s.step.id === journey.currentStepId);
    if (current && state.index > current.index) throw new FaError("INCOMPLETE", "earlier steps still need answers");
    if (state.missingRequired.length > 0) {
      throw new FaError("INCOMPLETE", "some required answers are missing", { missing: state.missingRequired });
    }

    const lastIndex = project.last_completed_step ? ctx.bundle.steps.findIndex((s) => s.id === project.last_completed_step) : -1;
    const newLast = state.index > lastIndex ? state.step.id : project.last_completed_step;
    if (newLast !== project.last_completed_step) {
      await tx.query("UPDATE project SET last_completed_step = $2, updated_at = $3 WHERE project_id = $1", [project.project_id, newLast, now]);
    }
    await recordJourneyEvent(tx, {
      eventType: "step_completed",
      projectId: project.project_id,
      stepId: state.step.id,
      questionBankVersion: project.question_bank_version,
      interfaceLanguage: project.interface_language,
      durationMs,
    });

    const next = computeJourney(ctx.bundle, stored, newLast);
    if (next.complete) {
      // Phase 8: findings, Snapshot and Internal Assessment are generated synchronously, in this
      // transaction, from the final applicable answers — before the lock makes them immutable.
      await generateAssessmentOutputs(tx, deps, project, ctx.bundle, next.effectiveAnswers, now);
      await tx.query("UPDATE project SET assessment_state = 'COMPLETED_LOCKED', updated_at = $2 WHERE project_id = $1", [project.project_id, now]);
      await tx.query("UPDATE fa_project_lifecycle SET completed_at = $2, updated_at = $2 WHERE project_id = $1", [project.project_id, now]);
      await recordJourneyEvent(tx, {
        eventType: "assessment_completed",
        projectId: project.project_id,
        questionBankVersion: project.question_bank_version,
        interfaceLanguage: project.interface_language,
      });
      // Phase 12: ids only — outbound destinations read what their mapping needs at delivery time.
      await tx.query("INSERT INTO outbox_event (project_id, event_type, payload, occurred_at) VALUES ($1, 'assessment.completed', $2::jsonb, $3)", [
        project.project_id,
        JSON.stringify({ project_id: project.project_id, question_bank_version: project.question_bank_version }),
        now,
      ]);
      await enqueueSnapshotEmail(tx, deps, project, now);
    }
    // Segmentation dimensions for analytics (enumerated values only, never answer content).
    await upsertProjectProfile(tx, {
      projectId: project.project_id,
      questionBankVersion: project.question_bank_version,
      effectiveAnswers: next.effectiveAnswers,
      now,
      completed: next.complete,
    });
    const refreshed = await loadProject(tx, project.project_id);
    if (!refreshed) throw new FaError("NOT_FOUND", "project not found");
    return buildSessionView(tx, refreshed, ctx.bundle);
  });
}

/** The interface language can change mid-flow; the choice is persisted on the person. */
export async function setInterfaceLanguage(deps: FaDeps, ctx: SessionContext, language: unknown): Promise<SessionView> {
  if (language !== "en" && language !== "es") throw new FaError("INVALID_INPUT", "language must be en or es", { fields: ["language"] });
  const now = deps.config.now();
  await deps.db.query("UPDATE person SET interface_language = $2, updated_at = $3 WHERE person_id = $1", [
    ctx.project.created_by_person_id,
    language,
    now,
  ]);
  await recordJourneyEvent(deps.db, {
    eventType: "language_changed",
    projectId: ctx.project.project_id,
    questionBankVersion: ctx.project.question_bank_version,
    interfaceLanguage: language,
    properties: { to: language },
  });
  const project = await loadProject(deps.db, ctx.project.project_id);
  if (!project) throw new FaError("NOT_FOUND", "project not found");
  return buildSessionView(deps.db, project, ctx.bundle);
}

/** After completing a project: start another project for the same company and person (Handoff v1 §8). */
export async function startAnotherProject(deps: FaDeps, ctx: SessionContext, acceptLegal: boolean): Promise<{ sessionToken: string }> {
  if (ctx.project.assessment_state !== "COMPLETED_LOCKED") throw new FaError("INCOMPLETE", "finish the current project first");
  if (!acceptLegal) throw new FaError("INVALID_INPUT", "legal acceptance is required", { fields: ["acceptLegal"] });
  const now = deps.config.now();
  return deps.db.transaction(async (tx) => {
    const { projectId, questionBankVersion } = await startProject(tx, deps, {
      personId: ctx.project.created_by_person_id,
      companyId: ctx.project.company_id,
      interfaceLanguage: ctx.project.interface_language,
      now,
    });
    const sessionToken = await issueToken(tx, projectId, "SESSION", ctx.token.email_verified, new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000));
    await recordJourneyEvent(tx, {
      eventType: "another_project_started",
      projectId,
      questionBankVersion,
      interfaceLanguage: ctx.project.interface_language,
      properties: { same_company: true },
    });
    return { sessionToken };
  });
}
