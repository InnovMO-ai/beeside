import { buildYourExpansionView, type Answers } from '@beeside/fa-public-engine';
import { SEED_CATALOG } from '@beeside/fa-public-engine/seed';

/** Test-only: the same deterministic model the API stores, computed from the seed catalog. */
export const modelFor = (a: Answers) => buildYourExpansionView(a, SEED_CATALOG, new Date('2026-10-04T12:00:00Z'));
