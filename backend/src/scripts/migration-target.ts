import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Migration TARGET guard (ADR-002). The state preflight (migration-state.ts) proves the applied history is a prefix of this build; it does NOT stop a
 * build from applying its newer migrations to a database that must not receive them. Example it prevents: an image built from main (54 migrations)
 * run by the Discovery production prepare job against the legacy `discovery` database (24) would otherwise apply 0024–0053 there.
 *
 * Policy file: db/migrations/migration-targets.json (shipped in the image next to the migrations).
 *   - a declared database with maxMigration X: refuse if any pending migration comes after X in this build's journal;
 *   - a declared database with maxMigration null: no ceiling;
 *   - an undeclared database: refused in production (NODE_ENV=production), allowed elsewhere (local, CI and test databases have arbitrary names);
 *   - missing or invalid policy in production: refused (fail closed).
 * There is deliberately no environment override: changing what a database may receive is a reviewed change to the policy file.
 */
export interface TargetPolicy { version: 1; targets: Record<string, { maxMigration: string | null; reason?: string }> }
export interface TargetCheck { ok: boolean; problems: string[]; ceiling: string | null | undefined }

export function readTargetPolicy(folder: string): TargetPolicy | null {
  const file = path.join(folder, "migration-targets.json");
  if (!existsSync(file)) return null;
  const p = JSON.parse(readFileSync(file, "utf8")) as TargetPolicy;
  if (p.version !== 1 || typeof p.targets !== "object" || p.targets === null) throw new Error("migration-targets.json: unsupported format");
  return p;
}

export function checkMigrationTarget(policy: TargetPolicy | null, database: string, journalTags: string[], pending: string[], production: boolean): TargetCheck {
  if (!policy) return production ? { ok: false, problems: ["migration-targets.json is missing from this build: refusing to migrate in production"], ceiling: undefined } : { ok: true, problems: [], ceiling: undefined };
  const target = Object.prototype.hasOwnProperty.call(policy.targets, database) ? policy.targets[database] : undefined;
  if (!target) return production ? { ok: false, problems: [`database "${database}" is not declared in migration-targets.json: refusing to migrate an unknown database in production`], ceiling: undefined } : { ok: true, problems: [], ceiling: undefined };
  if (target.maxMigration === null) return { ok: true, problems: [], ceiling: null };
  const cap = journalTags.indexOf(target.maxMigration);
  if (cap < 0) return { ok: false, problems: [`migration-targets.json caps "${database}" at ${target.maxMigration}, which is not in this build's journal`], ceiling: target.maxMigration };
  const beyond = pending.filter((t) => journalTags.indexOf(t) > cap);
  return beyond.length === 0
    ? { ok: true, problems: [], ceiling: target.maxMigration }
    : { ok: false, problems: [`database "${database}" may only receive migrations up to ${target.maxMigration}; this build would apply ${beyond.length} more (${beyond[0]} … ${beyond[beyond.length - 1]})`], ceiling: target.maxMigration };
}
