/** Postgres FrameStore over understanding_frame / understanding_frame_event (migrations 0035/0036). */
import type { Db } from "../../db/database";
import { FrameConflictError, type FrameEventKind, type FrameStore, type StoredFrame } from "./store";
import type { Frame } from "./types";

interface Row { frame: Frame; version: number; discovery_pin_id: string | null; closed_at: Date | null }
const toStored = (r: Row): StoredFrame => ({ frame: { ...r.frame, version: r.version }, version: r.version, discoveryPinId: r.discovery_pin_id, closedAt: r.closed_at ? r.closed_at.toISOString() : null });

export function createPgFrameStore(db: Db): FrameStore {
  const store: FrameStore = {
    async load(projectId) {
      const r = (await db.query<Row>("SELECT frame, version, discovery_pin_id, closed_at FROM understanding_frame WHERE project_id = $1", [projectId])).rows[0];
      return r ? toStored(r) : null;
    },
    async create(projectId, frame) {
      const f = { ...frame, version: 1 };
      await db.query(
        "INSERT INTO understanding_frame (project_id, version, locale, frame, discovery_pin_id) VALUES ($1, 1, $2, $3::jsonb, $4) ON CONFLICT (project_id) DO NOTHING",
        [projectId, f.locale, JSON.stringify(f), f.discoveryPinId ?? null],
      );
      const r = (await db.query<Row>("SELECT frame, version, discovery_pin_id, closed_at FROM understanding_frame WHERE project_id = $1", [projectId])).rows[0];
      if (!r) throw new Error("frame was not created");
      return toStored(r);
    },
    async save(projectId, frame, expectedVersion, opts) {
      const next = expectedVersion + 1;
      const f = { ...frame, version: next };
      const r = await db.query<Row>(
        `UPDATE understanding_frame SET version = $3, frame = $4::jsonb, locale = $5, discovery_pin_id = $6, updated_at = now(),
                closed_at = CASE WHEN $7::boolean THEN COALESCE(closed_at, now()) ELSE closed_at END
          WHERE project_id = $1 AND version = $2 RETURNING frame, version, discovery_pin_id, closed_at`,
        [projectId, expectedVersion, next, JSON.stringify(f), f.locale, f.discoveryPinId ?? null, Boolean(opts?.closed)],
      );
      if (!r.rows[0]) throw new FrameConflictError(projectId);
      return toStored(r.rows[0]);
    },
    async commit(projectId, frame, expectedVersion, event, opts) {
      return db.transaction(async (tx) => {
        const inner = createPgFrameStore(tx);
        const saved = await inner.save(projectId, frame, expectedVersion, opts);
        const fresh = await inner.appendEvent(projectId, event.turnKey, event.kind, saved.version, event.payload);
        if (!fresh) throw new FrameConflictError(projectId); // this turn was already applied: roll the save back
        return saved;
      });
    },
    async hasEvent(projectId, turnKey, kind) {
      return (await db.query("SELECT 1 FROM understanding_frame_event WHERE project_id = $1 AND turn_key = $2 AND kind = $3", [projectId, turnKey, kind])).rows.length > 0;
    },
    async appendEvent(projectId, turnKey, kind: FrameEventKind, frameVersion, payload) {
      const r = await db.query("INSERT INTO understanding_frame_event (project_id, turn_key, kind, frame_version, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (project_id, turn_key, kind) DO NOTHING", [projectId, turnKey, kind, frameVersion, JSON.stringify(payload)]);
      return (r.rowCount ?? 0) > 0;
    },
    async events(projectId) {
      const r = await db.query<{ turn_key: string; kind: FrameEventKind; frame_version: number; payload: Record<string, unknown> }>("SELECT turn_key, kind, frame_version, payload FROM understanding_frame_event WHERE project_id = $1 ORDER BY seq", [projectId]);
      return r.rows.map((x) => ({ turnKey: x.turn_key, kind: x.kind, frameVersion: x.frame_version, payload: x.payload }));
    },
  };
  return store;
}
