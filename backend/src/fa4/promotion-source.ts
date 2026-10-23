import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * Discovery -> Core CONTINUITY boundary (the identity half). Discovery publishes exactly what Core needs to recognise a delivered project as
 * a person and a company at the moment a valid entitlement is activated, and nothing else:
 *   - the project must be DELIVERED and own a sealed (immutable) result: the pin Precision will consume;
 *   - the person's e-mail, name and language as the person entered them (Core's own Person record is created from them ONCE, here);
 *   - whether the e-mail address has been shown to be the person's own (they opened a link Discovery e-mailed to it).
 * It reads no answers other than the identity block, never the rendered view (YEV), and writes nothing. The company comes from the sealed
 * result through the Precision contract (see continuity/discovery-promotion.ts), not from here.
 */
export interface Fa4PromotionSource {
  projectId: string;
  /** The sealed result of the project (the single delivered one in v1.0). */
  resultId: string;
  locale: "es" | "en";
  email: string;
  personName: string;
  /** The person opened a link Discovery e-mailed to this address: control of the mailbox is evidenced. */
  emailLinkVerified: boolean;
}

export async function getFa4PromotionSource(db: Db, projectId: string): Promise<Fa4PromotionSource> {
  const p = (await db.query<{ status: string; locale: "es" | "en"; email: string; name: string | null }>(
    "SELECT status, locale, email, answers->'identity'->>'name' AS name FROM fa4_project WHERE project_id = $1", [projectId])).rows[0];
  if (!p) throw new FaError("NOT_FOUND", "no Discovery project with this id");
  if (p.status !== "DELIVERED") throw new FaError("NOT_APPLICABLE", "only a delivered Discovery project can continue", { reason: "NOT_DELIVERED" });
  const r = (await db.query<{ result_id: string; anonymized: boolean | null }>(
    `SELECT result_id, (source_snapshot->>'anonymized')::boolean AS anonymized FROM fa4_result
      WHERE project_id = $1 AND NOT legacy_unsealed ORDER BY result_seq DESC LIMIT 1`, [projectId])).rows[0];
  if (!r) throw new FaError("NOT_READY", "the Discovery project has no sealed result", { reason: "NO_SEALED_RESULT" });
  if (r.anonymized) throw new FaError("NOT_RECOVERABLE", "the Discovery result was erased");
  const verified = (await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM fa4_access_token WHERE project_id = $1 AND kind IN ('RESUME','YEV_LINK') AND (used_at IS NOT NULL OR last_used_at IS NOT NULL)) AS ok`,
    [projectId])).rows[0]?.ok === true;
  return { projectId, resultId: r.result_id, locale: p.locale, email: p.email, personName: (p.name ?? "").trim(), emailLinkVerified: verified };
}
