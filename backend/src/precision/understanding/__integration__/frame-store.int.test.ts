import { Pool, type PoolClient } from "pg";
import { createSavepointDb, type Db } from "../../../db/database";
import { setupPrecisionFixture } from "../../../__tests__/helpers/precision-fixtures";
import { databaseUrl, describeWithDb } from "../../../__integration__/fa-harness";
import { emptyFrame } from "../types";
import { FrameConflictError } from "../store";
import { createPgFrameStore } from "../pg-store";

const NOW = "2026-10-14T12:00:00.000Z";

describeWithDb("Understanding frame store (PostgreSQL)", () => {
  let pool: Pool;
  let client: PoolClient;
  let db: Db;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 2 }); });
  afterAll(() => pool.end());
  beforeEach(async () => { client = await pool.connect(); await client.query("BEGIN"); db = createSavepointDb(client); });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  it("frame store: optimistic versions, idempotent events, conflict on stale write", async () => {
    const fx = await setupPrecisionFixture(db);
    const { projectId } = await fx.newProject("Frame");
    const store = createPgFrameStore(db);
    expect(await store.load(projectId)).toBeNull();
    const f = emptyFrame("es");
    const a = await store.create(projectId, f);
    expect(a.version).toBe(1);
    const again = await store.create(projectId, { ...f, locale: "en" });
    expect(again.frame.locale).toBe("es"); // the first creation wins
    const f2 = { ...a.frame, notes: [{ text: "nota", at: NOW }] };
    const b = await store.save(projectId, f2, 1);
    expect(b.version).toBe(2);
    expect(b.frame.version).toBe(2);
    await expect(store.save(projectId, f2, 1)).rejects.toBeInstanceOf(FrameConflictError);
    expect(await store.appendEvent(projectId, "turn-key-0001", "turn", 2, { changed: ["x"] })).toBe(true);
    expect(await store.appendEvent(projectId, "turn-key-0001", "turn", 2, { changed: ["x"] })).toBe(false);
    expect((await store.events(projectId)).length).toBe(1);
    const c = await store.save(projectId, b.frame, 2, { closed: true });
    expect(c.closedAt).not.toBeNull();
  });
});
