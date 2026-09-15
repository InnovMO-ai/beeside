import { Db } from "../../db/database";
import { QuestionBankBundle } from "../engine/bundle-types";
import { FaError } from "./errors";

/**
 * Reads question bank bundles from the Phase 3 registry. Published bundles are immutable, so a
 * version is cached once read; the "current" pointer is always read fresh.
 */
export class BundleStore {
  private readonly cache = new Map<string, QuestionBankBundle>();

  constructor(private readonly db: Db) {}

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
