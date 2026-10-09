/**
 * In-memory ConversationStore (tests, local rehearsal). Same contract as the Drizzle store: idempotent by
 * (projectId, turnKey, role), append-only, chronological by a monotonic sequence, per-project serialisation.
 */
import { randomUUID } from "node:crypto";
import type { ConversationStore, NewTurn, PersistedTurn, StoredTurn } from "../ports";

const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,120}$/;

export class MemoryConversationStore implements ConversationStore {
  private readonly rows: StoredTurn[] = [];
  private seq = 0;
  private readonly tails = new Map<string, Promise<unknown>>();
  /** Test hook: number of persistTurn calls that created a row. */
  createdCount = 0;

  async findByTurnKey(projectId: string, turnKey: string): Promise<{ client: StoredTurn | null; assistant: StoredTurn | null }> {
    const mine = this.rows.filter((r) => r.projectId === projectId && r.turnKey === turnKey);
    return { client: mine.find((r) => r.role === "client") ?? null, assistant: mine.find((r) => r.role === "assistant") ?? null };
  }

  async persistTurn(turn: NewTurn): Promise<PersistedTurn> {
    if (!KEY_FORMAT.test(turn.turnKey)) throw new Error("invalid turn key format");
    if (turn.content.length < 1 || turn.content.length > 8000) throw new Error("content length out of range");
    const existing = this.rows.find((r) => r.projectId === turn.projectId && r.turnKey === turn.turnKey && r.role === turn.role);
    if (existing) return { turn: existing, created: false };
    const row: StoredTurn = { id: randomUUID(), seq: ++this.seq, ...turn, createdAt: new Date() };
    this.rows.push(row);
    this.createdCount += 1;
    return { turn: row, created: true };
  }

  async loadThread(projectId: string, scopeInstanceId: string, limit: number): Promise<StoredTurn[]> {
    const all = this.rows.filter((r) => r.projectId === projectId && r.scopeInstanceId === scopeInstanceId).sort((a, b) => a.seq - b.seq);
    return all.slice(Math.max(0, all.length - limit));
  }

  async hasDisclosure(projectId: string): Promise<boolean> {
    return this.rows.some((r) => r.projectId === projectId && r.role === "assistant" && r.kind === "disclosure");
  }

  async hasAssistantTextContaining(projectId: string, needle: string): Promise<boolean> {
    return this.rows.some((r) => r.projectId === projectId && r.role === "assistant" && r.content.includes(needle));
  }

  async withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(projectId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tails.set(projectId, run.catch(() => undefined));
    return run as Promise<T>;
  }

  /** Test helper: every row, in order. */
  all(): StoredTurn[] {
    return [...this.rows].sort((a, b) => a.seq - b.seq);
  }
}
