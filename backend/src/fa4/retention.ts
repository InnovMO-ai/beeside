import { Db } from "../db/database";

/** Product/privacy rule (PO, 2026-10-12): a contact request written BEFORE Identity (no project) is kept 180 days from its latest interaction. */
export const ORPHAN_CONTACT_RETENTION_DAYS = 180;

/**
 * Irreversibly anonymizes the identifying fields and the message of orphan contact requests (project_id IS NULL) older than the retention period.
 * Idempotent (already-anonymized rows are skipped), bounded per run, safe to run concurrently (FOR UPDATE SKIP LOCKED) and with the
 * least-privilege runtime role (UPDATE only; nothing is deleted). A request linked to a project is NOT touched here: it follows the project's
 * rules (fa4_anonymize_project). Contact is never marketing consent and nothing about it is copied to the consent history.
 * "Latest interaction" = the request itself: an orphan request has no later activity (no session, no follow-up row).
 */
export async function purgeExpiredOrphanContacts(db: Db, now: Date, days = ORPHAN_CONTACT_RETENTION_DAYS, batch = 500): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await db.query(
    `UPDATE fa4_contact_request SET name = 'anonymized', company = 'anonymized', email = 'anonymized+' || contact_id::text || '@invalid.invalid', message = 'anonymized'
      WHERE contact_id IN (
        SELECT contact_id FROM fa4_contact_request
         WHERE project_id IS NULL AND created_at < $1 AND email NOT LIKE 'anonymized+%@invalid.invalid'
         ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)`,
    [cutoff, batch],
  );
  return r.rowCount ?? 0;
}
