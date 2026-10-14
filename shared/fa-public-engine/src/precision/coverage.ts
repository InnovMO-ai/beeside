/**
 * FIELD COVERAGE MATRIX (D-158 / acceptance 17): every FA4 source field is classified — no silent field loss.
 * `answers-schema` paths use `[]` for array items and `*` for record keys. A test walks the strict zod schema and fails if a field is missing here
 * (or listed here but no longer in the schema), and proves INCLUDED fields reach the source projection while EXCLUDED/RESTRICTED never do.
 *   INCLUDED      → in the sealed source-facts column and in `Fa4PrecisionContextV1.declared`
 *   EXCLUDED      → deliberately not stored in the envelope (reason given)
 *   RESTRICTED    → not client-safe / belongs to another system; never leaves its own table
 *   NOT_APPLICABLE→ cannot hold data for this purpose
 */
export type CoverageClass = 'INCLUDED' | 'EXCLUDED' | 'RESTRICTED' | 'NOT_APPLICABLE';
export interface CoverageEntry { cls: CoverageClass; reason?: string; contract?: string }

const I = (contract: string): CoverageEntry => ({ cls: 'INCLUDED', contract });

export const ANSWERS_COVERAGE: Record<string, CoverageEntry> = {
  locale: I('locale'),
  'identity.name': { cls: 'EXCLUDED', reason: 'contact PII; Precision continues the project through project_id, never through the person\'s name' },
  'identity.company': I('declared.company.name'),
  'identity.email': { cls: 'RESTRICTED', reason: 'contact PII; the email does not identify the project (D-155); stays in fa4_project only' },
  'identity.role': I('declared.company.role'),
  'identity.decider': I('declared.company.decisionRole'),
  'identity.termsAccepted': { cls: 'RESTRICTED', reason: 'legal acceptance evidence lives in fa4_legal_acceptance (D-085/D-159)' },
  'identity.privacyAcknowledged': { cls: 'RESTRICTED', reason: 'legal acceptance evidence lives in fa4_legal_acceptance (D-085/D-159)' },
  'identity.marketingConsent': { cls: 'RESTRICTED', reason: 'marketing consent lives in the append-only fa4_marketing_consent history (D-140/D-144)' },
  'company.hasExistingBusiness': I('declared.company.operatingBusiness'),
  'company.sector': I('declared.company.sector'),
  'company.size': I('declared.company.size'),
  'company.operatesIn[]': I('declared.company.operatesIn'),
  'destinations.list[].iso': I('declared.destinations.list[].country'),
  'destinations.list[].region': I('declared.destinations.list[].region'),
  'destinations.open': I('declared.destinations.open'),
  'destinations.sameInAll': I('declared.destinations.sameProjectInAll'),
  'components[].id': I('declared.components[].id'),
  'components[].destinations[]': I('declared.components[].countries'),
  'components[].description': I('declared.components[].description'),
  'components[].activities[]': I('declared.components[].activities'),
  'components[].withWhat[]': I('declared.components[].offering'),
  'components[].presence': I('declared.components[].presenceModel'),
  'components[].permanence': I('declared.components[].permanence'),
  'components[].durationMonths': I('declared.components[].durationMonths'),
  'components[].existing': I('declared.components[].currentPositionInDestination.state (D-153)'),
  'components[].existingNote': I('declared.components[].currentPositionInDestination.note'),
  'components[].sellsTo': I('declared.components[].customerType'),
  'components[].ownBrand': I('declared.components[].ownBrand'),
  'components[].location': I('declared.components[].exactLocation.state'),
  'components[].locationText': I('declared.components[].exactLocation.text'),
  'components[].carries[]': I('declared.components[].movesFromAbroad'),
  projectConfirmed: { cls: 'EXCLUDED', reason: 'internal flow state; "delivered" already implies the project was confirmed' },
  knowsNeeds: I('declared.clarityAnswer'),
  'reasons[]': I('declared.intent.motivations'),
  reasonText: I('declared.intent.motivationText'),
  decision: I('declared.intent.decision.state'),
  dependsOn: I('declared.intent.decision.dependsOn'),
  startWhen: I('declared.intent.startTiming'),
  'externalDate.has': I('declared.intent.externalDeadline.has'),
  'externalDate.date': I('declared.intent.externalDeadline.date'),
  'externalDate.what': I('declared.intent.externalDeadline.what'),
  'scale.*.proxy': I('declared.intent.projectSize[].proxy'),
  'scale.*.text': I('declared.intent.projectSize[].answer'),
  'scale.*.declined': I('declared.intent.projectSize[].state'),
  regulated: I('declared.intent.regulation'),
  'fronts.*.status': I('declared.topics[].status'),
  'fronts.*.support': I('declared.topics[].supportRequested'),
  'fronts.*.critical': I('declared.topics[].critical'),
  'fronts.*.marked': I('declared.topics[].markedByUser'),
  'fronts.*.note': { cls: 'NOT_APPLICABLE', reason: 'the field exists in the schema for compatibility; no screen collects it' },
  'addedNeeds[].id': { cls: 'EXCLUDED', reason: 'client-side row identifier with no meaning outside the editing session' },
  'addedNeeds[].text': I('declared.addedNeeds[].text'),
  'addedNeeds[].destination': I('declared.addedNeeds[].destination'),
  'cargoRoute.*': I('declared.cargoRoute'),
  'supportValues[]': I('declared.supportPreferences.values'),
  supportWords: I('declared.supportPreferences.words'),
  keepWords: I('declared.supportPreferences.keepInTeam'),
  'context.success': I('declared.notes.success'),
  'context.constraints': I('declared.notes.constraints'),
  'context.description': I('declared.notes.description'),
  'context.experience': I('declared.notes.priorExperience'),
  'context.unknowns': { cls: 'EXCLUDED', reason: 'no longer asked (D-152: 36 questions); what the client does not know is carried by structured open states' },
  'context.personalNeed': I('declared.notes.personalNeedExists (existence only, D-061)'),
};

/** Resolution-side fields (what FA derived) and what is deliberately NOT stored. */
export const RESOLUTION_COVERAGE: Record<string, CoverageEntry> = {
  catalogVersion: I('versions.catalogVersion'),
  premiumShown: I('derived.premiumShown'),
  'destinations[].destination': I('derived.destinations[].destination'),
  'destinations[].countryState': I('derived.destinations[].countryState'),
  'destinations[].countryMessage': I('derived.destinations[].countryMessage'),
  'destinations[].plan.notApplicable[]': I('derived.destinations[].notApplicable'),
  'destinations[].topics[]': I('derived.destinations[].topics'),
  'destinations[].needs[].front/origin/state/possible/because/status/support/critical/dependsCause/declaredTexts': I('derived.destinations[].needs[]'),
  'destinations[].needs[].capabilities[].capabilityId/state/coverageBasis/basisValue/coverage/conditionalOn': I('derived.destinations[].needs[].capabilities[]'),
  'destinations[].unmapped[].text': I('derived.destinations[].unmapped[].text (client text)'),
  'destinations[].needs[].trace / destinations[].unmapped[].trace': { cls: 'EXCLUDED', reason: 'rule/debug traces are internal' },
  'capabilities[].nameEs/nameEn/limitEs/limitEn': { cls: 'EXCLUDED', reason: 'presentation labels; stable capability IDs are enough and names change with the catalog' },
  'capabilities[].kind (HIVE / STRATEGIC_ADVISORY)': { cls: 'RESTRICTED', reason: 'provider-layer classification is internal (The Hive)' },
  'capabilities[].footnote': { cls: 'EXCLUDED', reason: 'presentation-only flag' },
  'catalog.capabilities[].internalRef / provider / sourcingPolicy / sourcing & triage owner': { cls: 'RESTRICTED', reason: 'provider names, sourcing and triage data never leave the internal demand layer (D-159)' },
};

/** Paths of a (zod v4) schema: `[]` for array items, `*` for record keys. Leaves are non-container schemas. */
export function schemaPaths(schema: unknown, prefix = ''): string[] {
  const def = (schema as { def?: Record<string, unknown> }).def;
  if (!def) return [prefix];
  const t = def.type as string;
  switch (t) {
    case 'object': {
      const shape = (def.shape ?? {}) as Record<string, unknown>;
      return Object.entries(shape).flatMap(([k, v]) => schemaPaths(v, prefix ? `${prefix}.${k}` : k));
    }
    case 'array': return schemaPaths(def.element, `${prefix}[]`);
    case 'record': return schemaPaths(def.valueType, `${prefix}.*`);
    case 'optional': case 'nullable': case 'default': case 'readonly': return schemaPaths(def.innerType, prefix);
    case 'pipe': return schemaPaths(def.in, prefix);
    default: return [prefix];
  }
}

/** Markdown of the matrix (docs/fa4/FIELD_COVERAGE_MATRIX.md is generated from it; a test fails when the file drifts). */
export function renderCoverageMarkdown(): string {
  const row = (p: string, e: CoverageEntry) => `| \`${p}\` | ${e.cls} | ${e.contract ? `\`${e.contract}\`` : ''} | ${e.reason ?? ''} |`;
  const head = '| Field | Class | Place in `Fa4PrecisionContextV1` | Reason |\n|---|---|---|---|';
  return [
    '# FA4 — field coverage matrix (source facts + resolution → Precision context)', '',
    'Generated by `node scripts/fa4-coverage-doc.js` from `shared/fa-public-engine/src/precision/coverage.ts` — **do not edit by hand**. A test keeps it complete:',
    'every field of the strict `Answers` schema must be classified, so no field is lost by accident.', '',
    'Classes: **INCLUDED** (sealed with the result and handed to Precision, with provenance) · **EXCLUDED** (deliberately not stored in the envelope) · **RESTRICTED** (not client-safe or owned by another system) · **NOT_APPLICABLE**.', '',
    '## A. Source facts (what the client declared)', '', head, ...Object.entries(ANSWERS_COVERAGE).map(([p, e]) => row(p, e)), '',
    '## B. Resolution (what FA derived)', '', head, ...Object.entries(RESOLUTION_COVERAGE).map(([p, e]) => row(p, e)), '',
    '## C. Provenance', '', '`declared.*` = `DECLARED_BY_USER` · `derived.*` = `DERIVED_FROM_FA`. Derived data is never placed inside `declared`. The retired free-text «what do you not know yet» is replaced by structured `declared.openStates`.', '',
  ].join('\n');
}
