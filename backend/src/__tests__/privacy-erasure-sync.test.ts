import { ErasureGateError, assertErasureConverged, manifestOf, parseManifest, reconcileErasures, type ErasureEntry } from "../db/privacy-erasure-sync";
import { checksumSql, upsertSql, type TablePlan } from "../db/domain-data-sync";
import type { Queryable } from "../db/domain-isolation";

/**
 * In-memory stand-in for one database side. It answers exactly the statements privacy-erasure-sync issues and implements fa4_anonymize_project the way the SQL function does
 * (scrub the project, write one log row). The SQL itself is exercised against real PostgreSQL by infra/db/rehearsal/rehearse-cutover.sh (C10-C15) and rehearse-on-clone.sh (S6c).
 */
interface LogRow { erasure_id: string; project_id: string; performed_at: string; actor: string; reason: string }
class FakeSide implements Queryable {
  log: LogRow[] = [];
  projects = new Map<string, { scrubbed: boolean }>();
  hasSchema = true;
  failAnonymize = false;
  anonymizeCalls = 0;
  private snapshot: string | null = null;
  private seq = 0;
  constructor(readonly name: string) {}
  addProject(id: string): this { this.projects.set(id, { scrubbed: false }); return this; }
  erase(id: string, at: string, actor = "op"): void {
    this.projects.get(id)!.scrubbed = true;
    this.log.push({ erasure_id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}${this.name.length}`.slice(0, 36), project_id: id, performed_at: at, actor, reason: "x" });
  }
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount?: number | null }> {
    const rows = (r: unknown[]): { rows: T[] } => ({ rows: r as T[] });
    if (/^(BEGIN)$/.test(sql)) { this.snapshot = JSON.stringify({ l: this.log, p: [...this.projects] }); return rows([]); }
    if (/^COMMIT$/.test(sql)) { this.snapshot = null; return rows([]); }
    if (/^ROLLBACK$/.test(sql)) { const s = JSON.parse(this.snapshot!) as { l: LogRow[]; p: Array<[string, { scrubbed: boolean }]> }; this.log = s.l; this.projects = new Map(s.p); return rows([]); }
    if (sql.includes("current_database()")) return rows([{ d: this.name }]);
    if (sql.includes("to_regclass('public.fa4_privacy_erasure_log')")) return rows(this.hasSchema ? [{ log: "fa4_privacy_erasure_log", project: "fa4_project", fn: "fa4_anonymize_project(uuid,text,text)" }] : [{ log: null, project: null, fn: null }]);
    if (sql.includes("FROM fa4_privacy_erasure_log ORDER BY performed_at")) return rows(this.log.map((l) => ({ ...l, performed_at: l.performed_at })));
    if (sql.includes("string_agg(erasure_id::text")) return rows([{ n: this.log.length, s: this.log.map((l) => l.erasure_id).sort().join(",") }]);
    if (sql.includes("FROM fa4_project p WHERE p.project_id = ANY")) {
      const ids = params[0] as string[];
      return rows(ids.filter((i) => this.projects.has(i)).sort().map((i) => ({ id: i, has_log: this.log.some((l) => l.project_id === i), residue: !this.projects.get(i)!.scrubbed })));
    }
    if (sql.includes("fa4_anonymize_project($1::uuid")) {
      this.anonymizeCalls += 1;
      if (this.failAnonymize) throw new Error("permission denied for function fa4_anonymize_project");
      const id = params[0] as string;
      if (!this.projects.has(id)) throw new Error("unknown FA project");
      this.projects.get(id)!.scrubbed = true;
      this.log.push({ erasure_id: `10000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}${this.name.length}`.slice(0, 36), project_id: id, performed_at: "2099-01-01T00:00:00.000000Z", actor: params[1] as string, reason: params[2] as string });
      return rows([]);
    }
    throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
  }
}

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const T = "2026-10-01T10:00:00.000000Z";

describe("erasure manifest", () => {
  const e = (id: string, p: string): ErasureEntry => ({ erasureId: id, projectId: p, performedAt: T, actor: "op", origin: "beeside" });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  it("is order independent, de-duplicated by erasure id, and carries only identifiers", () => {
    const m1 = manifestOf([e(A, P1), e(B, P2)]);
    const m2 = manifestOf([e(B, P2), e(A, P1), e(A, P1)]);
    expect(m2.sha256).toBe(m1.sha256);
    expect(m2.entries).toHaveLength(2);
    expect(Object.keys(m1.entries[0]!).sort()).toEqual(["actor", "erasureId", "origin", "performedAt", "projectId"]);
  });
  it("round-trips and refuses a tampered or malformed manifest", () => {
    const m = manifestOf([e(A, P1)]);
    expect(parseManifest(JSON.stringify(m)).sha256).toBe(m.sha256);
    expect(() => parseManifest(JSON.stringify({ ...m, entries: [{ ...m.entries[0]!, actor: "someone-else" }] }))).toThrow(/altered/);
    expect(() => parseManifest(JSON.stringify({ ...m, entries: [{ ...m.entries[0]!, projectId: "not-a-uuid" }] }))).toThrow(/malformed/);
    expect(() => parseManifest("{")).toThrow(ErasureGateError);
    expect(() => parseManifest(JSON.stringify({ version: 2, entries: [] }))).toThrow(/unsupported/);
  });
});

describe("erasure reconciliation (before, during and after the cutover)", () => {
  const sides = (): { legacy: FakeSide; canon: FakeSide } => ({ legacy: new FakeSide("discovery").addProject(P1).addProject(P2), canon: new FakeSide("beeside").addProject(P1).addProject(P2) });

  it("nothing erased: converged, nothing applied", async () => {
    const { legacy, canon } = sides();
    const r = await reconcileErasures(legacy, canon, { apply: true });
    expect(r.converged).toBe(true);
    expect([r.a.applied, r.b!.applied]).toEqual([0, 0]);
  });

  it("BEFORE: an erasure on legacy is a disagreement until reconciled; the gate refuses; reconciling scrubs the other side with evidence naming the origin", async () => {
    const { legacy, canon } = sides();
    legacy.erase(P1, T);
    await expect(assertErasureConverged(legacy, canon)).rejects.toThrow(/disagree/);
    const dry = await reconcileErasures(legacy, canon, { apply: false });
    expect(dry.converged).toBe(false);
    expect(canon.anonymizeCalls).toBe(0);
    const r = await reconcileErasures(legacy, canon, { apply: true });
    expect(r.converged).toBe(true);
    expect(r.b!.applied).toBe(1);
    expect(canon.projects.get(P1)!.scrubbed).toBe(true);
    expect(canon.projects.get(P2)!.scrubbed).toBe(false);
    expect(canon.log).toHaveLength(1);
    expect(canon.log[0]!.reason).toMatch(/^propagated of erasure .* \(origin discovery, actor op, at 2026-10-01/);
    expect(legacy.log).toHaveLength(1); // the origin side is never touched
    await expect(assertErasureConverged(legacy, canon)).resolves.toBeTruthy();
  });

  it("AFTER the cutover: an erasure on the canonical side reaches the legacy side before the rollback", async () => {
    const { legacy, canon } = sides();
    canon.erase(P2, T);
    const r = await reconcileErasures(legacy, canon, { apply: true });
    expect(r.a.applied).toBe(1);
    expect(legacy.projects.get(P2)!.scrubbed).toBe(true);
    expect(legacy.log[0]!.reason).toContain("origin beeside");
  });

  it("is idempotent: a second run applies nothing and the fingerprint of the union is stable", async () => {
    const { legacy, canon } = sides();
    legacy.erase(P1, T);
    await reconcileErasures(legacy, canon, { apply: true });
    const second = await reconcileErasures(legacy, canon, { apply: true });
    const third = await reconcileErasures(legacy, canon, { apply: true });
    expect([second.a.applied, second.b!.applied, third.a.applied, third.b!.applied]).toEqual([0, 0, 0, 0]);
    expect(third.manifestSha256).toBe(second.manifestSha256);
  });

  it("residual personal data on an erased project (a late row) is re-scrubbed and recorded as such", async () => {
    const { legacy, canon } = sides();
    legacy.erase(P1, T); canon.erase(P1, T);
    legacy.projects.get(P1)!.scrubbed = false; // a row attached after the erasure
    expect((await reconcileErasures(legacy, canon, { apply: false })).a.residue).toBe(1);
    const r = await reconcileErasures(legacy, canon, { apply: true });
    expect(r.a.applied).toBe(1);
    expect(legacy.log.at(-1)!.reason).toMatch(/^residual re-scrub/);
  });

  it("a project that does not exist yet on a side is not a problem (the sync copies the scrubbed rows)", async () => {
    const legacy = new FakeSide("discovery").addProject(P1);
    const canon = new FakeSide("beeside");
    legacy.erase(P1, T);
    const r = await reconcileErasures(legacy, canon, { apply: true });
    expect(r.converged).toBe(true);
    expect(canon.anonymizeCalls).toBe(0);
  });

  it("FAIL SAFE: an erasure that cannot be applied rolls that side back and stops with the gate error", async () => {
    const { legacy, canon } = sides();
    canon.erase(P1, T); canon.erase(P2, T);
    legacy.failAnonymize = true;
    await expect(reconcileErasures(legacy, canon, { apply: true })).rejects.toThrow(/could not be applied.*nothing was changed/);
    expect(legacy.log).toHaveLength(0);
  });

  it("FAIL SAFE: a side without the erasure log or function is never 'converged'", async () => {
    const { legacy, canon } = sides();
    canon.hasSchema = false;
    await expect(reconcileErasures(legacy, canon, { apply: false })).rejects.toThrow(/cannot be guaranteed/);
    await expect(assertErasureConverged(legacy, canon)).rejects.toBeInstanceOf(ErasureGateError);
  });

  it("OFFLINE (emergency rollback): a verified manifest from the unreachable side is applied on one side only", async () => {
    const legacy = new FakeSide("discovery").addProject(P1);
    const canonEntries = manifestOf([{ erasureId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", projectId: P1, performedAt: T, actor: "op", origin: "beeside" }]);
    const r = await reconcileErasures(legacy, null, { apply: true, offline: parseManifest(JSON.stringify(canonEntries)) });
    expect(r.converged).toBe(true);
    expect(legacy.projects.get(P1)!.scrubbed).toBe(true);
    expect(r.b).toBeNull();
  });
});

describe("domain data sync never overwrites or compares the scrubbing time of an erased row", () => {
  const plan = (table: string, columns: string[]): TablePlan => ({ table, pk: [columns[0]!], columns, policy: "upsert-by-updated_at", sequences: [] });
  it("a scrubbed target row is not overwritten by an upsert, whatever the source holds", () => {
    expect(upsertSql(plan("fa4_project", ["project_id", "email", "updated_at"]))).toContain(`AND NOT (public."fa4_project"."status" = 'ANONYMIZED')`);
    expect(upsertSql(plan("fa4_demand_signal", ["signal_id", "payload", "updated_at"]))).toContain(`AND NOT (public."fa4_demand_signal"."payload" = '{"anonymized": true}'::jsonb)`);
  });
  it("other tables keep their plain newer-wins rule", () => {
    expect(upsertSql(plan("fa4_email_delivery", ["delivery_id", "updated_at"]))).not.toContain("NOT (");
  });
  it("the checksum masks the time of scrubbing for scrubbed rows only", () => {
    const sql = checksumSql("fa4_project", ["project_id", "updated_at"], ["project_id"]);
    expect(sql).toContain(`CASE WHEN t."status" = 'ANONYMIZED' THEN to_jsonb('scrubbed'::text) ELSE to_jsonb(t."updated_at") END`);
    expect(checksumSql("fa4_access_token", ["token_id", "project_id", "revoked_at"], ["token_id"])).toContain("to_jsonb('scrubbed'::text)");
    expect(checksumSql("fa4_event", ["event_id", "created_at"], ["event_id"])).not.toContain("scrubbed");
  });
  it("the erasure ledger can be verified as a subset (each side appends its own evidence)", () => {
    expect(checksumSql("fa4_privacy_erasure_log", ["erasure_id"], ["erasure_id"], `t."erasure_id"::text = ANY($1::text[])`)).toContain("WHERE t.\"erasure_id\"::text = ANY($1::text[])");
  });
});
