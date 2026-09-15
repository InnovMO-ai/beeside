import { Db } from "../db/database";

/**
 * Candidate query for the temporary First Assessment retention lifecycle (Technical Architecture
 * v1.1 §4.3/§8). The automated job itself belongs to Phase 11; this contract already guarantees
 * that a project whose Premium was ever activated is never a candidate, and it locks candidates
 * with the same project row lock the Premium activation handler takes, so an activation that lands
 * first always wins.
 */
export async function temporaryRetentionCandidates(tx: Db, now: Date): Promise<string[]> {
  const { rows } = await tx.query<{ project_id: string }>("SELECT project_id FROM fa_temporary_retention_candidates($1)", [now]);
  return rows.map((r) => r.project_id);
}
