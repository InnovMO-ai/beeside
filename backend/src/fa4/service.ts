import {
  Answers,
  YourExpansionViewModel,
  buildYourExpansionView,
  deriveDemandSignals,
  resolveAll,
} from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { loadPublishedCatalog, replaceOpenSignals, storeResult } from "./repository";

/**
 * Generates and stores a delivered Your Expansion View: deterministic (answers + PUBLISHED catalog -> model), no AI.
 * The result row is append-only and carries the catalog version used (D-117). Demand Signals are derived in the same transaction.
 */
export async function deliverResult(db: Db, projectId: string, answers: Answers, now: Date): Promise<{ resultId: string; model: YourExpansionViewModel }> {
  return db.transaction(async (tx) => {
    const catalog = await loadPublishedCatalog(tx);
    const resolution = resolveAll(answers, catalog);
    const model = buildYourExpansionView(answers, catalog, now, resolution);
    const resultId = await storeResult(tx, projectId, model);
    await replaceOpenSignals(tx, projectId, deriveDemandSignals(projectId, answers, resolution, catalog, now));
    return { resultId, model };
  });
}
