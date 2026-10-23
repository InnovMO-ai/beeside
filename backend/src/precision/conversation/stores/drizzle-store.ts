/**
 * Drizzle-backed ConversationStore over `precision_turn` (migrations 0032/0033).
 *
 * The table definition below mirrors db/schema/precision.ts (`precisionTurn`) column for column; it is declared
 * here because the backend compiles with rootDir = src and cannot import the schema package directly. The table is
 * append-only (trigger) and unique on (project_id, turn_key, role), which is what makes persistTurn idempotent:
 * INSERT … ON CONFLICT DO NOTHING, then read the surviving row.
 *
 * `withProjectLock` takes a session-level advisory lock on a dedicated pooled client for the duration of `fn`, so
 * two requests for the same project never process turns concurrently, even across processes.
 */
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { ConversationStore, NewTurn, PersistedTurn, StoredTurn } from "../ports";
import type { Locale, Surface, TurnKind } from "../types";

export const precisionTurnTable = pgTable(
  "precision_turn",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    projectId: uuid("project_id").notNull(),
    scopeInstanceId: uuid("scope_instance_id").notNull(),
    turnKey: text("turn_key").notNull(),
    role: text("role").notNull(),
    surface: text("surface").notNull(),
    kind: text("kind").notNull().default("message"),
    locale: text("locale").notNull(),
    content: text("content").notNull(),
    structured: jsonb("structured").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("precision_turn_key_role_unique").on(t.projectId, t.turnKey, t.role), index("precision_turn_scope_idx").on(t.scopeInstanceId, t.seq)],
);

type Row = typeof precisionTurnTable.$inferSelect;

function toStored(r: Row): StoredTurn {
  return {
    id: r.id,
    seq: Number(r.seq),
    projectId: r.projectId,
    scopeInstanceId: r.scopeInstanceId,
    turnKey: r.turnKey,
    role: r.role as StoredTurn["role"],
    surface: r.surface as Surface,
    kind: r.kind as TurnKind,
    locale: r.locale as Locale,
    content: r.content,
    structured: (r.structured ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class DrizzleConversationStore implements ConversationStore {
  private readonly db: NodePgDatabase;

  constructor(private readonly pool: Pool) {
    this.db = drizzle(pool);
  }

  async findByTurnKey(projectId: string, turnKey: string): Promise<{ client: StoredTurn | null; assistant: StoredTurn | null }> {
    const rows = await this.db
      .select()
      .from(precisionTurnTable)
      .where(and(eq(precisionTurnTable.projectId, projectId), eq(precisionTurnTable.turnKey, turnKey)));
    const mapped = rows.map(toStored);
    return { client: mapped.find((r) => r.role === "client") ?? null, assistant: mapped.find((r) => r.role === "assistant") ?? null };
  }

  async persistTurn(turn: NewTurn): Promise<PersistedTurn> {
    const inserted = await this.db
      .insert(precisionTurnTable)
      .values({
        projectId: turn.projectId,
        scopeInstanceId: turn.scopeInstanceId,
        turnKey: turn.turnKey,
        role: turn.role,
        surface: turn.surface,
        kind: turn.kind,
        locale: turn.locale,
        content: turn.content,
        structured: turn.structured,
      })
      .onConflictDoNothing({ target: [precisionTurnTable.projectId, precisionTurnTable.turnKey, precisionTurnTable.role] })
      .returning();
    const first = inserted[0];
    if (first) return { turn: toStored(first), created: true };
    const existing = await this.db
      .select()
      .from(precisionTurnTable)
      .where(and(eq(precisionTurnTable.projectId, turn.projectId), eq(precisionTurnTable.turnKey, turn.turnKey), eq(precisionTurnTable.role, turn.role)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new Error("persistTurn: conflicting row vanished");
    return { turn: toStored(row), created: false };
  }

  async loadThread(projectId: string, scopeInstanceId: string, limit: number): Promise<StoredTurn[]> {
    const rows = await this.db
      .select()
      .from(precisionTurnTable)
      .where(and(eq(precisionTurnTable.projectId, projectId), eq(precisionTurnTable.scopeInstanceId, scopeInstanceId)))
      .orderBy(desc(precisionTurnTable.seq))
      .limit(Math.max(1, limit));
    return rows.map(toStored).sort((a, b) => a.seq - b.seq);
  }

  async hasDisclosure(projectId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: precisionTurnTable.id })
      .from(precisionTurnTable)
      .where(and(eq(precisionTurnTable.projectId, projectId), eq(precisionTurnTable.role, "assistant"), eq(precisionTurnTable.kind, "disclosure")))
      .limit(1);
    return rows.length > 0;
  }

  async hasAssistantTextContaining(projectId: string, needle: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: precisionTurnTable.id })
      .from(precisionTurnTable)
      .where(and(eq(precisionTurnTable.projectId, projectId), eq(precisionTurnTable.role, "assistant"), like(precisionTurnTable.content, `%${escapeLike(needle)}%`)))
      .orderBy(asc(precisionTurnTable.seq))
      .limit(1);
    return rows.length > 0;
  }

  async withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 42))", [`precision_turn:${projectId}`]);
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 42))", [`precision_turn:${projectId}`]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }
}
