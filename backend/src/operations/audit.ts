import { Db } from "../db/database";

/**
 * Append-only audit of sensitive Admin/Supervisor and system actions (admin_audit_event). Details
 * are technical facts only: secrets, tokens and personal data are stripped before writing.
 */
export type AuditActor = { type: "ADMIN_USER"; adminUserId: string } | { type: "SYSTEM" };
export type AuditOutcome = "ALLOWED" | "DENIED" | "FAILED";

export interface AuditInput {
  actor: AuditActor;
  action: string;
  outcome: AuditOutcome;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
  now: Date;
}

const FORBIDDEN_KEY = /token|secret|password|cookie|verifier|nonce|code|email|name|phone|answer|value|content/i;
const ALLOWED_KEYS = new Set(["job_run_id", "deleted_rows", "person_anonymized", "company_anonymized", "previous_state", "section", "reason", "permission", "role", "from_role", "to_role", "template", "status", "registry", "version", "decision", "diff_reviewed", "event_type", "request_id", "subscription_status", "result", "query_length", "results", "active", "login_enabled", "job", "trigger", "stats", "delivery_id", "count", "kind", "method", "path"]);

function sanitize(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.replace(/[^\s@]+@[^\s@]+/g, "[address]").slice(0, 200);
  if (depth > 2) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // Nested objects keep technical keys (e.g. table names in deleted_rows); top-level keys are allow-listed.
      if (depth === 0 && !ALLOWED_KEYS.has(key)) continue;
      if (depth === 0 && FORBIDDEN_KEY.test(key) && !ALLOWED_KEYS.has(key)) continue;
      out[key] = sanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}

export function sanitizeAuditDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitize(details ?? {}, 0) as Record<string, unknown>) ?? {};
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_event (occurred_at, actor_type, actor_admin_user_id, action, outcome, target_type, target_id, project_id, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      input.now,
      input.actor.type,
      input.actor.type === "ADMIN_USER" ? input.actor.adminUserId : null,
      input.action,
      input.outcome,
      input.targetType ?? null,
      input.targetId ?? null,
      input.projectId ?? null,
      input.requestId ?? null,
      JSON.stringify(sanitizeAuditDetails(input.details)),
    ],
  );
}
