import { Db } from "../db/database";

/**
 * Segmentation profile of a project for analytics (Phase 12): enumerated option values and ISO
 * country codes read from the effective structured answers — never names, emails, company data or
 * open text. Any value that is not a plain enumeration token is dropped before storage.
 */

export const PROFILE_FIELDS = {
  primaryGoal: "fa.goal.primary_goal",
  projectStage: "fa.project.stage",
  destinationStatus: "fa.project.destination_status",
  businessType: "fa.business.type",
  targetMarkets: "fa.project.target_markets",
  expectedCapabilities: "fa.operation.expected_capabilities",
  operationComponents: "fa.operation.components",
} as const;

const TOKEN = /^[a-z0-9_]{1,64}$/;
const COUNTRY = /^[A-Z]{2}$/;

const scalar = (value: unknown): string | null => (typeof value === "string" && TOKEN.test(value) ? value : null);
const list = (value: unknown, pattern: RegExp): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && pattern.test(v)))].sort().slice(0, 50) : [];

export interface ProjectProfile {
  primaryGoal: string | null;
  projectStage: string | null;
  entryMode: "new_market" | "already_operating" | null;
  destinationStatus: string | null;
  businessType: string | null;
  targetMarkets: string[];
  expectedCapabilities: string[];
  operationComponents: string[];
}

export function buildProjectProfile(effectiveAnswers: ReadonlyMap<string, unknown>): ProjectProfile {
  const stage = scalar(effectiveAnswers.get(PROFILE_FIELDS.projectStage));
  return {
    primaryGoal: scalar(effectiveAnswers.get(PROFILE_FIELDS.primaryGoal)),
    projectStage: stage,
    entryMode: stage === null ? null : stage === "already_operating" ? "already_operating" : "new_market",
    destinationStatus: scalar(effectiveAnswers.get(PROFILE_FIELDS.destinationStatus)),
    businessType: scalar(effectiveAnswers.get(PROFILE_FIELDS.businessType)),
    targetMarkets: list(effectiveAnswers.get(PROFILE_FIELDS.targetMarkets), COUNTRY),
    expectedCapabilities: list(effectiveAnswers.get(PROFILE_FIELDS.expectedCapabilities), TOKEN),
    operationComponents: list(effectiveAnswers.get(PROFILE_FIELDS.operationComponents), TOKEN),
  };
}

/** Upserts inside the caller's transaction. At completion the finding areas by status are added. */
export async function upsertProjectProfile(
  tx: Db,
  input: { projectId: string; questionBankVersion: string; effectiveAnswers: ReadonlyMap<string, unknown>; now: Date; completed: boolean },
): Promise<void> {
  const profile = buildProjectProfile(input.effectiveAnswers);
  let signalAreas: Record<string, string[]> = {};
  if (input.completed) {
    const { rows } = await tx.query<{ status: string; areas: string[] }>(
      `SELECT status::text AS status, array_agg(DISTINCT area_id ORDER BY area_id) AS areas
         FROM finding WHERE project_id = $1 AND status <> 'NOT_APPLICABLE' GROUP BY status`,
      [input.projectId],
    );
    signalAreas = Object.fromEntries(rows.map((r) => [r.status, r.areas.filter((a) => TOKEN.test(a))]));
  }
  await tx.query(
    `INSERT INTO analytics_project_profile (project_id, question_bank_version, primary_goal, project_stage, entry_mode, destination_status,
       business_type, target_markets, expected_capabilities, operation_components, signal_areas, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
     ON CONFLICT (project_id) DO UPDATE SET
       primary_goal = EXCLUDED.primary_goal, project_stage = EXCLUDED.project_stage, entry_mode = EXCLUDED.entry_mode,
       destination_status = EXCLUDED.destination_status, business_type = EXCLUDED.business_type,
       target_markets = EXCLUDED.target_markets, expected_capabilities = EXCLUDED.expected_capabilities,
       operation_components = EXCLUDED.operation_components,
       signal_areas = CASE WHEN EXCLUDED.completed_at IS NULL THEN analytics_project_profile.signal_areas ELSE EXCLUDED.signal_areas END,
       completed_at = COALESCE(analytics_project_profile.completed_at, EXCLUDED.completed_at),
       updated_at = EXCLUDED.updated_at`,
    [
      input.projectId,
      input.questionBankVersion,
      profile.primaryGoal,
      profile.projectStage,
      profile.entryMode,
      profile.destinationStatus,
      profile.businessType,
      profile.targetMarkets,
      profile.expectedCapabilities,
      profile.operationComponents,
      JSON.stringify(signalAreas),
      input.completed ? input.now : null,
      input.now,
    ],
  );
}
