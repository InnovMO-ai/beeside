/**
 * Precision Handoff Package — contract version 1 (Master Build Guide §19, Functional Specification
 * v1 §7, Technical Architecture v1.1 §10).
 *
 * Materialized exactly once per project, at the first premium_activated event, from the frozen
 * Snapshot and Internal Assessment of the locked First Assessment. It is a read contract keyed by
 * project_id in the same canonical database: Precision continues from it and from the canonical
 * First Assessment context — it never clones First Assessment and never regenerates this package.
 */

export interface PrecisionHandoffPackage {
  contractVersion: 1;
  generatedAt: string;
  projectId: string;
  personId: string;
  companyId: string;
  source: {
    snapshotId: string;
    internalAssessmentId: string;
    questionBankVersion: string;
    rulesEngineVersion: string;
    snapshotTemplateVersion: string;
    firstAssessmentCompletedAt: string | null;
  };
  /** How Precision must begin: acknowledge what is known, validate, then go deeper. */
  instruction: string;
  /** Everything already declared: Precision validates or corrects these instead of re-asking. */
  knownInformation: {
    source: "DECLARED_BY_USER";
    structuredFieldKeys: string[];
    openTextFieldKeys: string[];
  };
  executiveSummary: Record<string, string>;
  userNarrative: Record<string, unknown>;
  businessProfile: Record<string, unknown>;
  declaredPriority: Record<string, unknown>;
  priorityAlignment: unknown;
  findings: unknown[];
  candidateServices: unknown[];
  strategicSignals: unknown[];
  relevantCapabilities: unknown[];
  constraints: Record<string, unknown>;
  stopGoCriteria: string[];
  nextDecision: string | null;
  primaryConcern: string | null;
  volumetrics: unknown[];
  ownership: Record<string, unknown>;
  openQuestions: { notSureFieldKeys: string[] };
  precisionFocus: unknown[];
  guardrails: {
    /** A finding or capability is never a contracted, activated or assigned service. */
    findingsAreNotContractedServices: true;
    /** The handoff never opens direct Client–Provider contact on its own. */
    clientProviderDirectContact: "not_authorized";
    /** New Precision data lives under its own lifecycle and namespace. */
    precisionNamespace: "precision.*";
    /** Reactivation continues from this package; it is never regenerated. */
    regeneratedOnReactivation: false;
  };
}
