import { createHash } from "node:crypto";
import { Db } from "../../db/database";
import type { RulesEngineBundle } from "../../rules/types";
import type { SnapshotTemplateBundle } from "../../snapshot/template";
import { QuestionBankBundle } from "../engine/bundle-types";
import { FaError } from "./errors";

function withoutCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCopy);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "copy")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, withoutCopy(v)]),
    );
  }
  return value;
}

/**
 * Fingerprint of everything in a question bank the rules engine depends on: stages, steps and
 * questions (ids, field keys, types, option values, applicability) — not copy, emails, links,
 * lifecycle or Premium content. Two versions with the same fingerprint produce identical answers.
 */
export function questionSchemaFingerprint(bundle: Pick<QuestionBankBundle, "stages" | "steps" | "questions">): string {
  const schema = withoutCopy({ stages: bundle.stages, steps: bundle.steps, questions: bundle.questions });
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

/**
 * Reads versioned bundles from the Phase 3 registries. Published bundles are immutable, so a
 * version is cached once read; the "current" pointer is always read fresh.
 */
export class BundleStore {
  private readonly cache = new Map<string, QuestionBankBundle>();
  private readonly rulesCache = new Map<string, RulesEngineBundle>();
  private readonly templateCache = new Map<string, SnapshotTemplateBundle>();

  constructor(private readonly db: Db) {}

  /** The pinned Rules Engine bundle; placeholder or unknown versions cannot evaluate an assessment. */
  async rulesByVersion(version: string): Promise<RulesEngineBundle> {
    const cached = this.rulesCache.get(version);
    if (cached) return cached;
    const { rows } = await this.db.query<{ config: RulesEngineBundle }>(
      "SELECT config FROM rules_engine_version WHERE version = $1 AND status = 'PUBLISHED'",
      [version],
    );
    const bundle = rows[0]?.config;
    if (!bundle || bundle.product !== "first_assessment_rules") throw new FaError("NOT_READY", "the rules engine for this assessment is not available");
    this.rulesCache.set(version, bundle);
    return bundle;
  }

  /** The pinned Snapshot template bundle; placeholder or unknown versions cannot render a Snapshot. */
  async templateByVersion(version: string): Promise<SnapshotTemplateBundle> {
    const cached = this.templateCache.get(version);
    if (cached) return cached;
    const { rows } = await this.db.query<{ config: SnapshotTemplateBundle }>(
      "SELECT config FROM snapshot_template_version WHERE version = $1 AND status = 'PUBLISHED'",
      [version],
    );
    const bundle = rows[0]?.config;
    if (!bundle || bundle.product !== "first_assessment_snapshot") throw new FaError("NOT_READY", "the Snapshot template for this assessment is not available");
    this.templateCache.set(version, bundle);
    return bundle;
  }

  async byVersion(version: string): Promise<QuestionBankBundle> {
    const cached = this.cache.get(version);
    if (cached) return cached;
    const { rows } = await this.db.query<{ config: QuestionBankBundle }>(
      "SELECT config FROM question_bank_version WHERE version = $1 AND status = 'PUBLISHED'",
      [version],
    );
    const bundle = rows[0]?.config;
    if (!bundle || bundle.product !== "first_assessment") throw new FaError("NOT_FOUND", "question bank version not found");
    this.cache.set(version, bundle);
    return bundle;
  }

  async current(): Promise<{ version: string; bundle: QuestionBankBundle }> {
    const { rows } = await this.db.query<{ version: string }>("SELECT version FROM question_bank_version WHERE is_current");
    const version = rows[0]?.version;
    if (!version) throw new FaError("NOT_READY", "the First Assessment is not available yet");
    return { version, bundle: await this.byVersion(version) };
  }

  /**
   * A rules engine evaluates the question bank versions it lists, and any later version whose
   * question schema is identical to one of them (a copy, email, link, lifecycle or Premium content
   * publish never makes new assessments impossible to complete).
   */
  async questionBankCompatibleWith(listedVersions: readonly string[], version: string): Promise<boolean> {
    if (listedVersions.includes(version)) return true;
    const target = questionSchemaFingerprint(await this.byVersion(version));
    for (const listed of listedVersions) {
      try {
        if (questionSchemaFingerprint(await this.byVersion(listed)) === target) return true;
      } catch {
        // a listed version that is not published cannot vouch for compatibility
      }
    }
    return false;
  }
}
