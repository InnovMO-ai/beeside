import { createHash } from "node:crypto";
import {
  Answers,
  RESOLUTION_SCHEMA_VERSION,
  RULES_VERSION,
  SOURCE_SCHEMA_VERSION,
  YourExpansionViewModel,
  buildResolutionSnapshot,
  buildSourceSnapshot,
  buildYourExpansionView,
  canonicalJson,
  deriveDemandSignals,
  resolveAll,
} from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { latestResult, loadPublishedCatalog, sealResult, syncSignals } from "./repository";

/**
 * FA Public v1.0 result lifecycle (D-156 / D-157). Deterministic (answers + PUBLISHED catalog + rules → model), no AI.
 *
 *  PREVIEW   `previewResult`: computes the YEV from the current answers and returns it with a `previewToken`. NOTHING historical is written
 *            (no fa4_result row, no DELIVERED state): generating or viewing the YEV does not close FA and previews can be regenerated at will.
 *            Demand Signals are synchronized (idempotent, superseding), because they describe current demand, not a delivered result.
 *  DELIVERY  `deliverResult`: the ONLY writer of fa4_result. Runs when the client asks for the result by email or confirms «Comienza tu expansión».
 *            In ONE transaction: lock the project row → (idempotent) return the existing sealed result, or compute the YEV, seal the A+ envelope
 *            (source facts + structured resolution + catalog_version + rules_version) and mark the project DELIVERED.
 */

/** Identifies exactly what a preview showed: the source facts + catalog + rules. The delivery refuses to seal something the client has not seen. */
export function previewTokenFor(answers: Answers, catalogVersion: string): string {
  return createHash("sha256").update(canonicalJson({ source: buildSourceSnapshot(answers), catalogVersion, rulesVersion: RULES_VERSION })).digest("hex").slice(0, 32);
}

export async function previewResult(db: Db, projectId: string, answers: Answers, now: Date): Promise<{ model: YourExpansionViewModel; previewToken: string }> {
  return db.transaction(async (tx) => {
    const catalog = await loadPublishedCatalog(tx);
    const resolution = resolveAll(answers, catalog);
    const model = buildYourExpansionView(answers, catalog, now, resolution);
    await syncSignals(tx, projectId, deriveDemandSignals(projectId, answers, resolution, catalog, now));
    return { model, previewToken: previewTokenFor(answers, catalog.version) };
  });
}

export interface DeliveredResult { resultId: string; model: YourExpansionViewModel; deliveredAt: Date; alreadyDelivered: boolean }

export async function deliverResult(db: Db, projectId: string, now: Date, opts: { previewToken?: string; requirePremium?: boolean } = {}): Promise<DeliveredResult> {
  return db.transaction(async (tx) => {
    const row = (await tx.query<{ answers: Answers; status: string }>("SELECT answers, status FROM fa4_project WHERE project_id = $1 FOR UPDATE", [projectId])).rows[0];
    if (!row || row.status === "ANONYMIZED") throw new FaError("NOT_FOUND", "no such project");
    const existing = await latestResult(tx, projectId);
    if (existing) return { ...existing, alreadyDelivered: true };                                   // idempotent: a double click never creates a second delivery
    if (row.answers.company.hasExistingBusiness === false) throw new FaError("NOT_APPLICABLE", "this First Assessment is for existing businesses");
    const answers = row.answers;
    const catalog = await loadPublishedCatalog(tx);
    if (opts.previewToken !== undefined && opts.previewToken !== previewTokenFor(answers, catalog.version)) throw new FaError("STALE_PREVIEW", "the result changed since it was shown");
    const resolution = resolveAll(answers, catalog);
    const model = buildYourExpansionView(answers, catalog, now, resolution);
    if (opts.requirePremium && !model.premium.shown) throw new FaError("NOT_APPLICABLE", "no continuation is offered for this result");
    const sealed = await sealResult(tx, projectId, model, {
      catalogVersion: catalog.version, rulesVersion: RULES_VERSION,
      sourceSchemaVersion: SOURCE_SCHEMA_VERSION, sourceSnapshot: buildSourceSnapshot(answers),
      resolutionSchemaVersion: RESOLUTION_SCHEMA_VERSION, resolutionSnapshot: buildResolutionSnapshot(resolution),
    });
    await syncSignals(tx, projectId, deriveDemandSignals(projectId, answers, resolution, catalog, now));
    return { resultId: sealed.resultId, model, deliveredAt: sealed.deliveredAt, alreadyDelivered: false };
  });
}
