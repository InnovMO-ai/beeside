/**
 * Versioned configuration service (Build Plan v1.1 Phase 3; Technical Architecture v1.1 §5).
 *
 * Deliberately thin: every lifecycle rule — who may act, Draft → Preview → Publish transitions,
 * change classification, the content vs logic/schema review gate, immutability, and audit — is
 * enforced inside PostgreSQL by the config_* functions and guard triggers. This layer only calls
 * them and translates their SQLSTATE codes, so no code path (this one included) can bypass them.
 */

export const CONFIG_REGISTRIES = ["QUESTION_BANK", "RULES_ENGINE", "SNAPSHOT_TEMPLATE"] as const;
export type ConfigRegistry = (typeof CONFIG_REGISTRIES)[number];

export type ReviewDecision = "APPROVED" | "REJECTED";

export type ConfigVersioningErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "GATE_REFUSED"
  | "VALIDATION_FAILED"
  | "CONFLICT";

export class ConfigVersioningError extends Error {
  constructor(
    public readonly code: ConfigVersioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConfigVersioningError";
  }
}

const SQLSTATE_TO_CODE: Record<string, ConfigVersioningErrorCode> = {
  BV403: "FORBIDDEN",
  BV404: "NOT_FOUND",
  BV409: "INVALID_TRANSITION",
  BV412: "GATE_REFUSED",
  BV422: "VALIDATION_FAILED",
  "23505": "CONFLICT",
};

export function translateDbError(err: unknown): unknown {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = SQLSTATE_TO_CODE[String((err as { code: unknown }).code)];
    if (code) {
      const message = err instanceof Error ? err.message : String(err);
      return new ConfigVersioningError(code, message);
    }
  }
  return err;
}

/** Satisfied by pg.Pool, pg.Client and pg.PoolClient. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Whitelisted identifiers only — never interpolate request input into SQL.
const REGISTRY_TABLE: Record<ConfigRegistry, string> = {
  QUESTION_BANK: "question_bank_version",
  RULES_ENGINE: "rules_engine_version",
  SNAPSHOT_TEMPLATE: "snapshot_template_version",
};

export interface VersionSummary {
  version: string;
  status: "DRAFT" | "PREVIEW" | "PUBLISHED";
  change_kind: "CONTENT" | "LOGIC_SCHEMA" | null;
  content_hash: string | null;
  base_version: string | null;
  is_current: boolean;
  created_at: string;
  previewed_at: string | null;
  published_at: string | null;
}

export function createConfigVersioningService(db: Queryable) {
  async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
    try {
      const result = await db.query(text, values);
      return result.rows as T[];
    } catch (err) {
      throw translateDbError(err);
    }
  }

  async function scalar<T>(text: string, values: unknown[]): Promise<T> {
    const [first] = await rows<{ result: T }>(text, values);
    return (first as { result: T }).result;
  }

  const table = (registry: ConfigRegistry) => REGISTRY_TABLE[registry];

  return {
    async createDraft(registry: ConfigRegistry, version: string, config: object, actor: string): Promise<void> {
      await rows("SELECT config_create_draft($1::config_registry, $2, $3::jsonb, $4::uuid)", [
        registry, version, JSON.stringify(config), actor,
      ]);
    },

    async updateDraft(registry: ConfigRegistry, version: string, config: object, actor: string): Promise<void> {
      await rows("SELECT config_update_draft($1::config_registry, $2, $3::jsonb, $4::uuid)", [
        registry, version, JSON.stringify(config), actor,
      ]);
    },

    submitForPreview(registry: ConfigRegistry, version: string, actor: string): Promise<Record<string, unknown>> {
      return scalar<Record<string, unknown>>("SELECT config_submit_for_preview($1::config_registry, $2, $3::uuid) AS result", [
        registry, version, actor,
      ]);
    },

    async returnToDraft(registry: ConfigRegistry, version: string, actor: string, reason: string): Promise<void> {
      await rows("SELECT config_return_to_draft($1::config_registry, $2, $3::uuid, $4)", [registry, version, actor, reason]);
    },

    recordReview(
      registry: ConfigRegistry,
      version: string,
      actor: string,
      review: { decision: ReviewDecision; diffReviewed: boolean; notes: string | null },
    ): Promise<string> {
      return scalar<string>(
        "SELECT config_record_review($1::config_registry, $2, $3::uuid, $4::config_review_decision, $5, $6) AS result",
        [registry, version, actor, review.decision, review.diffReviewed, review.notes],
      );
    },

    publish(registry: ConfigRegistry, version: string, actor: string): Promise<Record<string, unknown>> {
      return scalar<Record<string, unknown>>("SELECT config_publish($1::config_registry, $2, $3::uuid) AS result", [registry, version, actor]);
    },

    setCurrent(registry: ConfigRegistry, version: string, actor: string, reason: string): Promise<Record<string, unknown>> {
      return scalar<Record<string, unknown>>("SELECT config_set_current($1::config_registry, $2, $3::uuid, $4) AS result", [
        registry, version, actor, reason,
      ]);
    },

    /** The versions a project started right now would be pinned to (null = not yet published). */
    async currentVersions(): Promise<Record<ConfigRegistry, string | null>> {
      const [row] = await rows<{ question_bank: string | null; rules_engine: string | null; snapshot_template: string | null }>(
        `SELECT (SELECT version FROM question_bank_version WHERE is_current) AS question_bank,
                (SELECT version FROM rules_engine_version WHERE is_current) AS rules_engine,
                (SELECT version FROM snapshot_template_version WHERE is_current) AS snapshot_template`,
      );
      return {
        QUESTION_BANK: row?.question_bank ?? null,
        RULES_ENGINE: row?.rules_engine ?? null,
        SNAPSHOT_TEMPLATE: row?.snapshot_template ?? null,
      };
    },

    listVersions(registry: ConfigRegistry): Promise<VersionSummary[]> {
      return rows<VersionSummary>(
        `SELECT version, status, change_kind, content_hash, base_version, is_current, created_at, previewed_at, published_at
           FROM ${table(registry)} ORDER BY created_at DESC, version`,
      );
    },

    async getVersion(registry: ConfigRegistry, version: string) {
      const [detail] = await rows<VersionSummary & { config: unknown; diff_against_current: unknown }>(
        `SELECT v.version, v.status, v.change_kind, v.content_hash, v.base_version, v.is_current, v.created_at,
                v.previewed_at, v.published_at, v.config,
                config_jsonb_diff((SELECT c.config FROM ${table(registry)} AS c WHERE c.is_current), v.config) AS diff_against_current
           FROM ${table(registry)} AS v WHERE v.version = $1`,
        [version],
      );
      if (!detail) {
        throw new ConfigVersioningError("NOT_FOUND", `${table(registry)} ${version} not found`);
      }
      const column = table(registry);
      const reviews = await rows(
        `SELECT review_id, decision, change_kind, diff_reviewed, content_hash, base_version, diff, notes,
                reviewer_admin_user_id, reviewed_at
           FROM config_version_review WHERE registry = $1::config_registry AND ${column} = $2 ORDER BY reviewed_at`,
        [registry, version],
      );
      const events = await rows(
        `SELECT event_id, event_type, from_status, to_status, content_hash, actor_admin_user_id, details, occurred_at
           FROM config_version_event WHERE registry = $1::config_registry AND ${column} = $2 ORDER BY occurred_at`,
        [registry, version],
      );
      return { ...detail, reviews, events };
    },
  };
}

export type ConfigVersioningService = ReturnType<typeof createConfigVersioningService>;
