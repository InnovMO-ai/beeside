/**
 * ConversationStore contract, run against the in-memory store always and against the Drizzle store over
 * `precision_turn` when TEST_DATABASE_URL points at a migrated scratch database
 * (local: postgres://beeside:beeside@localhost:5432/beeside_conv, migrations via `npm run db:migrate`).
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPoolDb } from "../../../db/database";
import { setupPrecisionFixture } from "../../../__tests__/helpers/precision-fixtures";
import type { ConversationStore, NewTurn } from "../ports";
import { DrizzleConversationStore } from "../stores/drizzle-store";
import { MemoryConversationStore } from "../stores/memory-store";
import { World } from "./helpers";
import { copyText } from "../copy";

const turn = (projectId: string, scopeInstanceId: string, over: Partial<NewTurn> = {}): NewTurn => ({
  projectId,
  scopeInstanceId,
  turnKey: `key-${randomUUID().slice(0, 12)}`,
  role: "client",
  surface: "category",
  kind: "message",
  locale: "es",
  content: "hola",
  structured: {},
  ...over,
});

function contract(name: string, make: () => Promise<{ store: ConversationStore; project: () => Promise<{ projectId: string; scopeId: string }> }>): void {
  describe(`${name}: ConversationStore contract`, () => {
    it("persistTurn is idempotent by (project, turnKey, role); the two roles of one key coexist", async () => {
      const { store, project } = await make();
      const { projectId, scopeId } = await project();
      const base = turn(projectId, scopeId, { turnKey: "idem-key-0001" });
      const a = await store.persistTurn(base);
      expect(a.created).toBe(true);
      const b = await store.persistTurn({ ...base, content: "otro texto" });
      expect(b.created).toBe(false);
      expect(b.turn.id).toBe(a.turn.id);
      expect(b.turn.content).toBe("hola");
      const asst = await store.persistTurn({ ...base, role: "assistant", content: "respuesta", structured: { state: { mode: "ask" } } });
      expect(asst.created).toBe(true);
      const found = await store.findByTurnKey(projectId, "idem-key-0001");
      expect(found.client?.id).toBe(a.turn.id);
      expect(found.assistant?.id).toBe(asst.turn.id);
      expect(found.assistant?.structured).toEqual({ state: { mode: "ask" } });
      expect(await store.findByTurnKey(projectId, "nothing-here-01")).toEqual({ client: null, assistant: null });
    });

    it("loadThread is chronological and returns the most recent rows of one scope only", async () => {
      const { store, project } = await make();
      const one = await project();
      const other = await project();
      for (let i = 1; i <= 5; i++) await store.persistTurn(turn(one.projectId, one.scopeId, { turnKey: `thread-key-000${i}`, content: `m${i}`, role: i % 2 ? "client" : "assistant" }));
      await store.persistTurn(turn(other.projectId, other.scopeId, { turnKey: "thread-other-01", content: "ajeno" }));
      const all = await store.loadThread(one.projectId, one.scopeId, 50);
      expect(all.map((r) => r.content)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      expect(all.map((r) => r.seq)).toEqual([...all.map((r) => r.seq)].sort((x, y) => x - y));
      const last2 = await store.loadThread(one.projectId, one.scopeId, 2);
      expect(last2.map((r) => r.content)).toEqual(["m4", "m5"]);
      expect(await store.loadThread(other.projectId, one.scopeId, 10)).toEqual([]);
    });

    it("hasDisclosure and hasAssistantTextContaining are per project and literal", async () => {
      const { store, project } = await make();
      const a = await project();
      const b = await project();
      expect(await store.hasDisclosure(a.projectId)).toBe(false);
      await store.persistTurn(turn(a.projectId, a.scopeId, { turnKey: "disc-key-0001", role: "assistant", kind: "disclosure", content: "Precision usa inteligencia artificial" }));
      await store.persistTurn(turn(a.projectId, a.scopeId, { turnKey: "text-key-0001", role: "assistant", content: "Tu Category Requirement Pack (CRP) y 100% literal_" }));
      await store.persistTurn(turn(a.projectId, a.scopeId, { turnKey: "text-key-0002", role: "client", content: "Category Requirement Pack (CRP) dicho por el cliente" }));
      expect(await store.hasDisclosure(a.projectId)).toBe(true);
      expect(await store.hasDisclosure(b.projectId)).toBe(false);
      expect(await store.hasAssistantTextContaining(a.projectId, "Category Requirement Pack (CRP)")).toBe(true);
      expect(await store.hasAssistantTextContaining(a.projectId, "100% literal_")).toBe(true);
      expect(await store.hasAssistantTextContaining(a.projectId, "100_ literal")).toBe(false);
      expect(await store.hasAssistantTextContaining(b.projectId, "Category Requirement Pack (CRP)")).toBe(false);
    });

    it("withProjectLock serialises the same project, lets other projects run, and releases on error", async () => {
      const { store, project } = await make();
      const a = await project();
      const b = await project();
      const order: string[] = [];
      const slow = (label: string, ms: number) => async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
        return label;
      };
      const results = await Promise.all([store.withProjectLock(a.projectId, slow("a1", 60)), store.withProjectLock(a.projectId, slow("a2", 10))]);
      expect(results).toEqual(["a1", "a2"]);
      expect(order).toEqual(["a1:start", "a1:end", "a2:start", "a2:end"]);
      order.length = 0;
      await Promise.all([store.withProjectLock(a.projectId, slow("pa", 60)), store.withProjectLock(b.projectId, slow("pb", 10))]);
      expect(order.indexOf("pb:end")).toBeLessThan(order.indexOf("pa:end"));
      await expect(store.withProjectLock(a.projectId, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      await expect(store.withProjectLock(a.projectId, async () => "after")).resolves.toBe("after");
    });
  });
}

contract("memory", async () => {
  const store = new MemoryConversationStore();
  return { store, project: async () => ({ projectId: randomUUID(), scopeId: randomUUID() }) };
});

const URL = process.env.TEST_DATABASE_URL;
const dbDescribe = URL ? describe : describe.skip;

dbDescribe("drizzle: precision_turn (TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let store: DrizzleConversationStore;
  let newProject: () => Promise<{ projectId: string; scopeId: string }>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    const fixture = await setupPrecisionFixture(createPoolDb(pool));
    store = new DrizzleConversationStore(pool);
    newProject = async () => {
      const { projectId } = await fixture.newProject("ConvStore");
      const inst = await pool.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id", [projectId]);
      return { projectId, scopeId: (inst.rows[0] as { id: string }).id };
    };
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  contract("drizzle", async () => ({ store, project: () => newProject() }));

  it("enforces the table constraints (turn key format, content length, role/surface/kind) and the append-only trigger", async () => {
    const { projectId, scopeId } = await newProject();
    await expect(store.persistTurn(turn(projectId, scopeId, { turnKey: "short" }))).rejects.toThrow();
    await expect(store.persistTurn(turn(projectId, scopeId, { content: "" }))).rejects.toThrow();
    await expect(store.persistTurn(turn(projectId, scopeId, { content: "x".repeat(8001) }))).rejects.toThrow();
    const ok = await store.persistTurn(turn(projectId, scopeId, { turnKey: "append-only-001", content: "x".repeat(8000) }));
    expect(ok.created).toBe(true);
    await expect(pool.query("UPDATE precision_turn SET content = 'cambiado' WHERE id = $1", [ok.turn.id])).rejects.toThrow();
    await expect(pool.query("DELETE FROM precision_turn WHERE id = $1", [ok.turn.id])).rejects.toThrow();
  });

  it("refuses a scope that belongs to another project (cross-project scoping)", async () => {
    const mine = await newProject();
    const theirs = await newProject();
    const err: unknown = await store.persistTurn(turn(mine.projectId, theirs.scopeId, { turnKey: "cross-key-0001" })).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    // Drizzle wraps the driver error; the trigger message lives on `cause`.
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    expect(cause?.message ?? "").toMatch(/cross-project/);
    expect(cause?.code).toBe("BV409");
  });

  it("two processes racing on the same turnKey create exactly one row per role", async () => {
    const { projectId, scopeId } = await newProject();
    const t = turn(projectId, scopeId, { turnKey: "race-key-00001" });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.persistTurn(t)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.turn.id)).size).toBe(1);
  });

  it("the whole engine runs on the Drizzle store: ordering, replay, process question, AI failure + retry", async () => {
    const { projectId, scopeId } = await newProject();
    const w = new World({ surface: "understanding", locale: "es", store, projectId, scopeId });
    const opened = await w.open();
    expect(opened.turns.map((t) => t.kind)).toEqual(["disclosure", "message"]);
    expect(opened.turns[0]?.text).toBe(copyText("ai_disclosure_once", "es").text);

    const key = "drizzle-turn-0001";
    const first = await w.say("Queremos entrar a Chile", key);
    expect(first.status).toBe("ok");
    const again = await w.say("Queremos entrar a Chile", key);
    expect(again.turns.map((t) => t.id)).toEqual(first.turns.map((t) => t.id));
    expect(w.writer.applied.size).toBe(2); // objective + destinations, once

    const q = await w.say("¿Qué pasa con este requisito?");
    expect(q.meta.turnKind).toBe("process_question");
    expect(w.writer.applied.size).toBe(2);

    w.provider.failNext(1);
    const failKey = "drizzle-fail-0001";
    expect((await w.say("marzo de 2027", failKey)).status).toBe("ai_unavailable");
    expect((await w.say("marzo de 2027", failKey)).status).toBe("ok");
    expect(w.writer.applied.size).toBe(3);

    const thread = await store.loadThread(projectId, scopeId, 100);
    expect(thread.filter((r) => r.kind === "disclosure")).toHaveLength(1);
    expect(thread.filter((r) => r.turnKey === failKey).map((r) => r.role)).toEqual(["client", "assistant"]);
    const seqs = thread.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  }, 60_000);
});
