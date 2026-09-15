/**
 * FA → Precision logical contract.
 *
 * Precision consumes canonical First Assessment context; it does not clone FA. This type is
 * assembled on read from the canonical tables (person, company, project, answer, state history,
 * findings, capability_rank, snapshot) — there is no table that copies it. Precision writes its
 * own data later under `precision.*` on the same project_id.
 */

import type { SupportedLocale } from "./fields";

export type FirstAssessmentStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED_LOCKED" | "EXPIRED" | "DELETED";

export interface FirstAssessmentAnswer {
  fieldKey: string;
  /** Stored canonical value (select values, ISO codes, timing/quantity objects, raw text). */
  value: unknown;
  questionId: string | null;
  answeredAt: string;
  /** Always DECLARED_BY_USER in First Assessment. */
  source: "DECLARED_BY_USER";
}

export interface FirstAssessmentPrecisionContext {
  contractVersion: 1;
  projectId: string;
  personId: string;
  companyId: string;
  person: {
    firstName: string;
    lastName: string;
    preferredName: string | null;
    interactionLanguage: SupportedLocale | string;
    deliverableLanguage: SupportedLocale | string;
  };
  company: { name: string; website: string | null };
  /** Destination country/market(s), ISO 3166-1 alpha-2, plus optional region/city detail. */
  targetMarkets: string[];
  targetLocationDetail: string | null;
  /** fa.business.type */
  industry: string | null;
  /** fa.goal.primary_goal */
  projectObjective: string | null;
  timing: {
    launchTimingStatus: string | null;
    launchTarget: unknown;
    timingDriver: string | null;
  };
  declaredPriority: {
    priorityKnown: string | null;
    clientPriority: string | null;
    timing: string | null;
    reason: string | null;
  };
  /** Every applicable structured (non-open-text) answer, keyed by field_key. */
  structuredAnswers: Record<string, FirstAssessmentAnswer>;
  /** Every applicable open-text answer, verbatim, keyed by field_key. */
  openTextAnswers: Record<string, FirstAssessmentAnswer>;
  /** Applicable answers whose value is an explicit "not sure" selection (open questions for Precision). */
  notSureFieldKeys: string[];
  assessment: {
    status: FirstAssessmentStatus;
    startedAt: string | null;
    completedAt: string | null;
    questionBankVersion: string;
    rulesEngineVersion: string;
    snapshotTemplateVersion: string;
  };
  /** Present once the Rules Engine (Phase 7) has produced them. */
  findings: Array<{ areaId: number; status: string; signalStrength: string; evidenceFieldKeys: string[] }>;
  relevantCapabilities: Array<{ categoryId: number; rank: number; includedInSnapshot: boolean }>;
  /** Present once the Snapshot (Phase 8) exists. */
  snapshot: { snapshotId: string; generatedAt: string; snapshotTemplateVersion: string } | null;
}
