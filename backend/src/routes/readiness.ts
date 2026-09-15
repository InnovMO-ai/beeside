import { readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { Db } from "../db/database";

/**
 * Readiness (Phase 13 deployment pipeline): the service reports ready only when the database is
 * reachable and every migration this build ships has been applied, so a revision never serves
 * traffic against a schema that is behind it. Answers carry a status word only.
 */
export function readinessRouter(db: Db, expectedMigrations: number): Router {
  const router = Router();
  router.get("/health/ready", (_req, res) => {
    db.query<{ applied: number }>("SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations")
      .then(({ rows }) => {
        const applied = rows[0]?.applied ?? 0;
        if (applied < expectedMigrations) res.status(503).json({ status: "not_ready", reason: "schema_behind" });
        else res.json({ status: "ready" });
      })
      .catch(() => res.status(503).json({ status: "not_ready", reason: "database_unavailable" }));
  });
  return router;
}

/** Number of migrations committed with this build (backend/db/migrations/meta/_journal.json). */
export function shippedMigrationCount(journalPath = path.resolve(__dirname, "../../db/migrations/meta/_journal.json")): number {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: unknown[] };
  return Array.isArray(journal.entries) ? journal.entries.length : 0;
}
