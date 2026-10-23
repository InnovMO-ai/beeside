import type { Db } from "../../db/database";
import type { FaContextRead, FaContextReader } from "../../precision/ports/fa-context";
import { createFaContextService } from "../../precision/domain/fa-context";
import { understandingInherited } from "../../precision/domain/context-reader";
import { paManifestContent } from "../../precision/domain/pa-manifest";
import { evaluateCategory, type FactMap } from "../../precision/manifest";

/**
 * Discovery → Precision BRIDGE conformance — what Precision itself guarantees once a reader (fixture today, the real Discovery reader
 * later) hands it a context. It complements `faContextConformance` (what the READER must guarantee) and encodes continuity, not
 * sufficiency:
 *
 *   - provenance: every inherited value carries the pin and the source item it came from, and the pin names the exact result;
 *   - the pin is a REFERENCE (ids, versions, hash), never a copy of Discovery's content, so nothing depends on mutable raw data;
 *   - determinism: the same pinned source yields the same offer, from any service instance, any number of times;
 *   - supersession: a re-run is a new pin; the old pin stays as it was; exactly one is current;
 *   - tolerance: unknown additive fields in the source are ignored, never propagated;
 *   - failure: no context (or a failing reader) means NO offer and NO pin, never a value without provenance;
 *   - STARTING POINT, NOT SUFFICIENCY: inherited values create no fact, and even if every one is confirmed Understanding is not complete.
 *
 * Nothing here defines the Discovery contract.
 */
export interface DiscoveryBridgeSubject {
  db: Db;
  reader: FaContextReader;
  /** A Precision project (row in `project`) for which the reader has a delivered result with objective, destination and a start window. */
  projectId: string;
  /** Delivers a NEW result for the same project (a re-run). Optional: without it supersession is not checked. */
  redeliver?: () => Promise<void> | void;
}

const silent = () => undefined;
const PIN_COLUMNS = ["id", "project_id", "source_system", "source_project_id", "source_result_id", "catalog_version", "contract_version", "crosswalk_version", "context_hash", "read_at", "status", "superseded_by_pin_id", "created_at"];

interface PinRow { id: string; source_project_id: string; source_result_id: string; contract_version: string; context_hash: string; status: string; superseded_by_pin_id: string | null }

export function discoveryBridgeConformance(name: string, make: () => DiscoveryBridgeSubject | Promise<DiscoveryBridgeSubject>): void {
  describe(`Discovery → Precision bridge conformance — ${name}`, () => {
    let s: DiscoveryBridgeSubject;
    const pins = async (): Promise<PinRow[]> =>
      (await s.db.query<PinRow>("SELECT id, source_project_id, source_result_id, contract_version, context_hash, status, superseded_by_pin_id FROM context_pin WHERE project_id = $1 ORDER BY created_at, id", [s.projectId])).rows;
    const offer = (reader: FaContextReader = s.reader, answered: ReadonlySet<string> = new Set()) =>
      understandingInherited({ db: s.db, log: silent }, createFaContextService(reader, silent), s.projectId, "es", answered);
    const factCount = async (): Promise<number> =>
      Number((await s.db.query<{ n: string }>("SELECT count(*) AS n FROM fact f JOIN precision_instance i ON i.id = f.scope_instance_id WHERE i.project_id = $1", [s.projectId])).rows[0]!.n);

    beforeEach(async () => { s = await make(); });

    it("gives every inherited value its pin and its source item, and the pin names the exact result that was read", async () => {
      const read = (await s.reader.read(s.projectId)) as FaContextRead;
      const inherited = await offer();
      expect(inherited.length).toBeGreaterThan(0);
      const rows = await pins();
      expect(rows.filter((p) => p.status === "current")).toHaveLength(1);
      const pin = rows.find((p) => p.status === "current")!;
      expect(pin.source_project_id).toBe(s.projectId);
      expect(pin.source_result_id).toBe(read.sourceResultId);
      expect(pin.context_hash).toBe(read.contextHash);
      expect(pin.contract_version).toBe(read.contractVersion);
      for (const v of inherited) {
        expect(v.sourcePinId).toBe(pin.id);
        expect(typeof v.sourceItemRef).toBe("string");
        expect((v.sourceItemRef ?? "").length).toBeGreaterThan(0);
      }
      // no two values claim the same source item
      expect(new Set(inherited.map((v) => v.sourceItemRef)).size).toBe(inherited.length);
    });

    it("keeps the pin a reference: only identity, versions and hash are stored — never a copy of Discovery's content", async () => {
      await offer();
      const cols = (await s.db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'context_pin'")).rows.map((r) => r.column_name).sort();
      expect(cols).toEqual([...PIN_COLUMNS].sort());
    });

    it("is deterministic: the same pinned source gives the same offer and the same pin, from any service instance, repeatedly", async () => {
      const a = await offer();
      const b = await offer();
      const c = await offer(s.reader); // a third, independent service
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      expect(await pins()).toHaveLength(1);
    });

    it("offers a value only for fields the client has not answered", async () => {
      const all = await offer();
      const some = await offer(s.reader, new Set([all[0]!.fieldKey]));
      expect(some.map((v) => v.fieldKey)).not.toContain(all[0]!.fieldKey);
      expect(some).toHaveLength(all.length - 1);
    });

    it("a re-run is a new current pin; the old pin keeps describing the old result and points to its successor", async () => {
      if (!s.redeliver) return;
      const before = await offer();
      const oldPin = (await pins()).find((p) => p.status === "current")!;
      await s.redeliver();
      const after = await offer(); // fresh service: no cache
      const rows = await pins();
      const current = rows.filter((p) => p.status === "current");
      expect(current).toHaveLength(1);
      expect(current[0]!.id).not.toBe(oldPin.id);
      const old = rows.find((p) => p.id === oldPin.id)!;
      expect(old.status).toBe("superseded");
      expect(old.superseded_by_pin_id).toBe(current[0]!.id);
      expect(old.source_result_id).toBe(oldPin.source_result_id);
      expect(old.context_hash).toBe(oldPin.context_hash);
      for (const v of after) expect(v.sourcePinId).toBe(current[0]!.id);
      expect(after.map((v) => v.fieldKey)).toEqual(before.map((v) => v.fieldKey));
    });

    it("tolerates additive fields it does not know (a later schema version) without propagating them", async () => {
      const baseline = await offer();
      const extended: FaContextReader = {
        describe: () => s.reader.describe(),
        async read(projectId) {
          const r = await s.reader.read(projectId);
          if (!r) return r;
          const ctx = r.context as unknown as Record<string, Record<string, unknown>>;
          ctx.project!.futureField = "from a later version";
          ctx.futureBlock = { anything: [1, 2, 3] };
          (r as unknown as Record<string, unknown>).futureTopLevel = true;
          return r;
        },
      };
      const withExtras = await offer(extended);
      expect(withExtras).toEqual(baseline);
      expect(JSON.stringify(withExtras)).not.toContain("later version");
    });

    it("never offers a value without provenance: no delivered context, or a failing reader, means no offer and no pin", async () => {
      const before = (await pins()).length;
      const empty: FaContextReader = { describe: () => s.reader.describe(), read: async () => null };
      const broken: FaContextReader = { describe: () => s.reader.describe(), read: async () => { throw new Error("upstream down"); } };
      expect(await offer(empty)).toEqual([]);
      expect(await offer(broken)).toEqual([]);
      expect((await pins()).length).toBe(before);
    });

    it("is a STARTING POINT, not sufficiency: offering creates no fact, and confirming everything inherited still leaves Understanding open", async () => {
      const factsBefore = await factCount();
      const inherited = await offer();
      expect(await factCount()).toBe(factsBefore); // PREFILL_CONFIRM only: nothing is a fact until the client confirms

      const manifest = paManifestContent();
      const countries: string[] = [];
      const none = evaluateCategory({ manifest, facts: {}, countries });
      // Pretend the client confirmed every inherited value as-is.
      const confirmed: Record<string, { value: unknown; answerState: "ANSWERED"; provenance: string }> = {};
      for (const v of inherited) confirmed[v.fieldKey] = { value: v.value, answerState: "ANSWERED", provenance: "client_confirmed" };
      const afterConfirm = evaluateCategory({ manifest, facts: confirmed as FactMap, countries });
      expect(afterConfirm.confirmedRequired).toBeGreaterThan(none.confirmedRequired);
      // Whatever Discovery supplied, required understanding that only the client/conversation can give is still pending.
      expect(afterConfirm.pending.length).toBeGreaterThan(0);
      expect(afterConfirm.progressPct ?? 0).toBeLessThan(100);
      expect(afterConfirm.pending.map((p) => p.fieldKey)).toEqual(expect.arrayContaining(["pa_expansion_product_or_service", "pa_operating_entity"]));
    });
  });
}
