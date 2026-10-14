/** Persistence port of the project frame. One row per project; every write states the version it read (optimistic concurrency). */
import type { Frame } from "./types";

export class FrameConflictError extends Error {
  constructor(projectId: string) { super(`stale frame write for project ${projectId}`); this.name = "FrameConflictError"; }
}
export type FrameEventKind = "seed" | "turn" | "edit" | "correction" | "freshness" | "close";
export interface StoredFrame { frame: Frame; version: number; discoveryPinId: string | null; closedAt: string | null }

export interface FrameStore {
  load(projectId: string): Promise<StoredFrame | null>;
  /** Creates the frame at version 1; returns the existing one if another request created it first. */
  create(projectId: string, frame: Frame): Promise<StoredFrame>;
  /** Saves `frame` as expectedVersion + 1. Throws FrameConflictError when the stored version moved. */
  save(projectId: string, frame: Frame, expectedVersion: number, opts?: { closed?: boolean }): Promise<StoredFrame>;
  /**
   * Saves the frame AND records the event in ONE atomic step (so a crash can never leave a frame that advanced without its event).
   * Throws FrameConflictError when the stored version moved.
   */
  commit(projectId: string, frame: Frame, expectedVersion: number, event: { turnKey: string; kind: FrameEventKind; payload: Record<string, unknown> }, opts?: { closed?: boolean }): Promise<StoredFrame>;
  /** True when the event of this turn was already recorded (the frame already reflects it). */
  hasEvent(projectId: string, turnKey: string, kind: FrameEventKind): Promise<boolean>;
  /** Idempotent by (project, turnKey, kind): returns false when it already existed. */
  appendEvent(projectId: string, turnKey: string, kind: FrameEventKind, frameVersion: number, payload: Record<string, unknown>): Promise<boolean>;
  events(projectId: string): Promise<{ turnKey: string; kind: FrameEventKind; frameVersion: number; payload: Record<string, unknown> }[]>;
}

export class InMemoryFrameStore implements FrameStore {
  private frames = new Map<string, StoredFrame>();
  private ev = new Map<string, { turnKey: string; kind: FrameEventKind; frameVersion: number; payload: Record<string, unknown> }[]>();
  async load(projectId: string): Promise<StoredFrame | null> { const f = this.frames.get(projectId); return f ? clone(f) : null; }
  async create(projectId: string, frame: Frame): Promise<StoredFrame> {
    const ex = this.frames.get(projectId);
    if (ex) return clone(ex);
    const s: StoredFrame = { frame: clone(frame), version: 1, discoveryPinId: frame.discoveryPinId ?? null, closedAt: null };
    s.frame.version = 1; this.frames.set(projectId, s); return clone(s);
  }
  async save(projectId: string, frame: Frame, expectedVersion: number, opts?: { closed?: boolean }): Promise<StoredFrame> {
    const ex = this.frames.get(projectId);
    if (!ex || ex.version !== expectedVersion) throw new FrameConflictError(projectId);
    const s: StoredFrame = { frame: clone(frame), version: expectedVersion + 1, discoveryPinId: frame.discoveryPinId ?? null, closedAt: opts?.closed ? "closed" : ex.closedAt };
    s.frame.version = s.version; this.frames.set(projectId, s); return clone(s);
  }
  async commit(projectId: string, frame: Frame, expectedVersion: number, event: { turnKey: string; kind: FrameEventKind; payload: Record<string, unknown> }, opts?: { closed?: boolean }): Promise<StoredFrame> {
    const ex = this.frames.get(projectId);
    if (!ex || ex.version !== expectedVersion) throw new FrameConflictError(projectId);
    if (await this.hasEvent(projectId, event.turnKey, event.kind)) throw new FrameConflictError(projectId);
    const s = await this.save(projectId, frame, expectedVersion, opts);
    await this.appendEvent(projectId, event.turnKey, event.kind, s.version, event.payload);
    return s;
  }
  async hasEvent(projectId: string, turnKey: string, kind: FrameEventKind): Promise<boolean> { return (this.ev.get(projectId) ?? []).some((e) => e.turnKey === turnKey && e.kind === kind); }
  async appendEvent(projectId: string, turnKey: string, kind: FrameEventKind, frameVersion: number, payload: Record<string, unknown>): Promise<boolean> {
    const l = this.ev.get(projectId) ?? [];
    if (l.some((e) => e.turnKey === turnKey && e.kind === kind)) return false;
    l.push({ turnKey, kind, frameVersion, payload }); this.ev.set(projectId, l); return true;
  }
  async events(projectId: string) { return [...(this.ev.get(projectId) ?? [])]; }
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
