/**
 * Facts over the database. Every fact is `fact.field_key = "precision." + manifest field_key` (the column's CHECK enforces
 * the prefix, `pa_*` keys included) and every write goes through `fact_record()` (append-only, superseding).
 *
 * The `FactWriter` the conversation module calls is idempotent without a ledger of its own: a candidate whose value,
 * answer state and provenance equal the current fact is a no-op, so a turn reprocessed after a crash (same `turnKey`,
 * same candidates) has no second effect. Group values merge on the same item index, so the result is stable too.
 */
import type { Db } from "../../db/database";
import { canonicalJson } from "../ports/operation-hub";
import type { FactMap, FactView } from "../manifest/types";
import type { FactWriter } from "../conversation/ports";
import type { CandidateFact, Surface } from "../conversation/types";

export const FACT_PREFIX = "precision.";
export const factKey = (fieldKey: string): string => `${FACT_PREFIX}${fieldKey}`;
export const fieldKeyOf = (key: string): string => (key.startsWith(FACT_PREFIX) ? key.slice(FACT_PREFIX.length) : key);

export interface FactRow {
  id: string;
  fieldKey: string;
  value: unknown;
  answerState: FactView["answerState"];
  provenance: string;
  sourcePinId: string | null;
  createdAt: Date;
}

type Queryable = Pick<Db, "query">;

export async function loadFactRows(db: Queryable, scopeInstanceId: string): Promise<FactRow[]> {
  const { rows } = await db.query<{ id: string; field_key: string; value: unknown; answer_state: FactView["answerState"]; provenance_stage: string; source_pin_id: string | null; created_at: Date }>(
    "SELECT id, field_key, value, answer_state, provenance_stage, source_pin_id, created_at FROM fact WHERE scope_instance_id = $1 AND superseded_by IS NULL ORDER BY created_at, id",
    [scopeInstanceId],
  );
  return rows.map((r) => ({ id: r.id, fieldKey: fieldKeyOf(r.field_key), value: r.value, answerState: r.answer_state, provenance: r.provenance_stage, sourcePinId: r.source_pin_id, createdAt: r.created_at }));
}

export function factMapOf(rows: readonly FactRow[]): FactMap {
  const out: Record<string, FactView | undefined> = {};
  for (const r of rows) out[r.fieldKey] = { value: r.value, answerState: r.answerState, provenance: r.provenance };
  return out;
}

export async function loadFactMap(db: Queryable, scopeInstanceId: string): Promise<FactMap> {
  return factMapOf(await loadFactRows(db, scopeInstanceId));
}

/**
 * The current fact maps of several scope instances in ONE query (same rows, same order and same last-wins rule as
 * `loadFactMap`, so each map is identical to the one the single-instance loader returns). Instances without facts get `{}`.
 */
export async function loadFactMaps(db: Queryable, scopeInstanceIds: readonly string[]): Promise<Map<string, FactMap>> {
  const out = new Map<string, FactMap>();
  for (const id of scopeInstanceIds) out.set(id, {});
  if (scopeInstanceIds.length === 0) return out;
  const { rows } = await db.query<{ scope_instance_id: string; id: string; field_key: string; value: unknown; answer_state: FactView["answerState"]; provenance_stage: string }>(
    "SELECT scope_instance_id, id, field_key, value, answer_state, provenance_stage FROM fact WHERE scope_instance_id = ANY($1::uuid[]) AND superseded_by IS NULL ORDER BY created_at, id",
    [[...scopeInstanceIds]],
  );
  for (const r of rows) {
    const map = out.get(r.scope_instance_id) as Record<string, FactView | undefined> | undefined;
    if (map) map[fieldKeyOf(r.field_key)] = { value: r.value, answerState: r.answer_state, provenance: r.provenance_stage };
  }
  return out;
}

export interface WriteStep { fieldKey: string; factId: string; after: FactMap }
export interface FactWriteInfo {
  projectId: string;
  scopeInstanceId: string;
  surface: Surface;
  turnKey: string;
  before: FactMap;
  /** One entry per fact actually written (no-ops are omitted), with the cumulative fact map after it. */
  steps: WriteStep[];
}
export interface FactWriteHooks {
  /** Runs inside the same transaction as the fact writes (events, lifecycle moves). A throw rolls everything back. */
  afterWrite?(tx: Db, info: FactWriteInfo): Promise<void>;
}

export interface RecordFactInput {
  projectId: string;
  scopeInstanceId: string;
  source: "precision_assessment" | "category";
  fact: CandidateFact;
}

/** Writes one candidate; returns the new fact id or null when it was a no-op. */
export async function recordCandidateFact(tx: Db, input: RecordFactInput, current: FactMap): Promise<string | null> {
  const f = input.fact;
  const cur = current[f.fieldKey];
  if (cur && cur.answerState === f.answerState && cur.provenance === f.provenanceStage && canonicalJson(cur.value) === canonicalJson(f.value)) return null;
  const confidence = f.provenanceStage === "ai_extracted" && typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : null;
  const { rows } = await tx.query<{ id: string }>(
    "SELECT fact_record($1, $2, $3, $4::jsonb, $5, $6::fact_answer_state, $7::fact_source, $8::fact_provenance_stage, $9, $10, $11) AS id",
    [
      input.projectId, input.scopeInstanceId, factKey(f.fieldKey), JSON.stringify(f.value ?? null), f.valueType, f.answerState, input.source, f.provenanceStage, confidence,
      f.sourcePinId ?? null, f.sourcePinId ? (f.sourceItemRef ?? null) : null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("fact_record returned no id");
  return id;
}

export class DbFactWriter implements FactWriter {
  constructor(
    private readonly db: Db,
    private readonly hooks: FactWriteHooks = {},
    /** Decides the `fact.source` of a scope: the project's PA instance vs a category instance. */
    private readonly sourceOf: (surface: Surface) => RecordFactInput["source"] = (s) => (s === "understanding" ? "precision_assessment" : "category"),
  ) {}

  async recordFacts(args: { projectId: string; scopeInstanceId: string; surface: Surface; turnKey: string; facts: CandidateFact[] }): Promise<void> {
    if (args.facts.length === 0) return;
    await this.db.transaction(async (tx) => {
      const before = await loadFactMap(tx, args.scopeInstanceId);
      let current = before;
      const steps: WriteStep[] = [];
      for (const fact of args.facts) {
        const id = await recordCandidateFact(tx, { projectId: args.projectId, scopeInstanceId: args.scopeInstanceId, source: this.sourceOf(args.surface), fact }, current);
        if (!id) continue;
        current = { ...current, [fact.fieldKey]: { value: fact.value, answerState: fact.answerState, provenance: fact.provenanceStage } };
        steps.push({ fieldKey: fact.fieldKey, factId: id, after: current });
      }
      if (steps.length > 0 && this.hooks.afterWrite) {
        await this.hooks.afterWrite(tx, { projectId: args.projectId, scopeInstanceId: args.scopeInstanceId, surface: args.surface, turnKey: args.turnKey, before, steps });
      }
    });
  }
}

/** System-derived facts (never asked): same single write path, provenance `system_derived`. A no-op when the value is unchanged. */
export async function recordSystemFact(
  tx: Db,
  input: { projectId: string; scopeInstanceId: string; source: RecordFactInput["source"]; fieldKey: string; value: unknown; valueType: string },
  current: FactMap,
): Promise<string | null> {
  const cur = current[input.fieldKey];
  if (cur && cur.answerState === "ANSWERED" && canonicalJson(cur.value) === canonicalJson(input.value)) return null;
  const { rows } = await tx.query<{ id: string }>(
    "SELECT fact_record($1, $2, $3, $4::jsonb, $5, 'ANSWERED'::fact_answer_state, $6::fact_source, 'system_derived'::fact_provenance_stage, NULL, NULL, NULL) AS id",
    [input.projectId, input.scopeInstanceId, factKey(input.fieldKey), JSON.stringify(input.value ?? null), input.valueType, input.source],
  );
  return rows[0]?.id ?? null;
}

/** Serialises every change to the project's map structure (same key `precision_psm_new_version` takes, so they interlock). */
export async function lockProjectMap(tx: Pick<Db, "query">, projectId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`psm:${projectId}`]);
}
