import type { Db } from "../../../db/database";
import { loadFactMap, loadFactMaps } from "../facts";

/** GET /center batching: the batched loader must return exactly what the per-instance loader returns, in one query. */
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const ROWS = [
  { scope_instance_id: A, id: "1", field_key: "precision.origin_country", value: "CL", answer_state: "ANSWERED", provenance_stage: "client_stated", source_pin_id: null, created_at: new Date("2026-10-01") },
  { scope_instance_id: B, id: "2", field_key: "precision.map_needs", value: [], answer_state: "ANSWERED", provenance_stage: "system", source_pin_id: null, created_at: new Date("2026-10-01") },
  { scope_instance_id: A, id: "3", field_key: "precision.origin_country", value: "PE", answer_state: "ANSWERED", provenance_stage: "client_stated", source_pin_id: null, created_at: new Date("2026-10-02") }, // later row wins
  { scope_instance_id: A, id: "4", field_key: "precision.pa_time_window", value: null, answer_state: "UNKNOWN", provenance_stage: "client_stated", source_pin_id: null, created_at: new Date("2026-10-03") },
];

const fakeDb = () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const ids = (Array.isArray(params[0]) ? params[0] : [params[0]]) as string[];
      return { rows: ROWS.filter((r) => ids.includes(r.scope_instance_id)), rowCount: 0 };
    },
  } as unknown as Db;
  return { db, calls };
};

describe("loadFactMaps (GET /center batching)", () => {
  it("returns the same map as loadFactMap for every instance, using one query", async () => {
    const batch = fakeDb();
    const maps = await loadFactMaps(batch.db, [A, B, C]);
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0]!.sql).toMatch(/scope_instance_id = ANY\(\$1::uuid\[\]\)/);
    expect(batch.calls[0]!.sql).toMatch(/superseded_by IS NULL/);
    for (const id of [A, B, C]) expect(maps.get(id)).toEqual(await loadFactMap(fakeDb().db, id));
    expect(maps.get(A)!.origin_country).toEqual({ value: "PE", answerState: "ANSWERED", provenance: "client_stated" });
    expect(maps.get(C)).toEqual({}); // an instance without facts still has a map
  });

  it("does not query for an empty list", async () => {
    const batch = fakeDb();
    expect((await loadFactMaps(batch.db, [])).size).toBe(0);
    expect(batch.calls).toHaveLength(0);
  });
});
