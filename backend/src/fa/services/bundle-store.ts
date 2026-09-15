import { Db } from "../../db/database";
import type { RulesEngineBundle } from "../../rules/types";
import type { SnapshotTemplateBundle } from "../../snapshot/template";
import { QuestionBankBundle } from "../engine/bundle-types";
import { FaError } from "./errors";

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
}
