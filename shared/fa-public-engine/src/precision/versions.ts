/**
 * Versioning of the FA4 historical result envelope (Public v1.0, D-157/D-158). One identifier per concern, no overlap:
 *  - RULES_VERSION              the deterministic rule set that produced the resolution (routing, topic activation, coverage, D-149 proxy…).
 *                               Bump it whenever a rule changes its outcome; `rules-golden.test.ts` fails if outcomes drift without a bump.
 *  - SOURCE_SCHEMA_VERSION      shape/semantics of the `source_snapshot` (v1 = Public v1.0, incl. `existing: commercial_traction`, D-153).
 *  - RESOLUTION_SCHEMA_VERSION  shape of the `resolution_snapshot`.
 *  - CONTRACT_VERSION           the FA4 → Precision contract (`Fa4PrecisionContextV1`).
 *  - MAPPER_VERSION             the pure mapper that builds the contract from a sealed result.
 */
/** Changelog of rule-outcome changes: D-122 (legal applies with local hiring) · D-124 (no group-link inference) · D-149 (size proxy) · VT-02 (declared negatives only) · VT-03 (no empty thematic screens: flow only). */
export const RULES_VERSION = 'fa4-rules/2026-10-14.1';
export const SOURCE_SCHEMA_VERSION = 1;
export const RESOLUTION_SCHEMA_VERSION = 1;
export const CONTRACT_VERSION = 'fa4-precision-context/1';
export const MAPPER_VERSION = '1.0.0';
