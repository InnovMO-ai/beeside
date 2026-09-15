import { Db } from "../db/database";
import { PROFILE_FIELDS } from "../analytics/project-profile";
import { OutboundEvent, SourceValue } from "./types";

/**
 * The allow-listed values a destination mapping may use. A mapping can only reference these keys;
 * everything is read (SELECT only) from PostgreSQL at delivery time, so outbox rows never copy
 * personal data and a purged project yields no record at all.
 */
export const SOURCE_KEYS = [
  "project.id",
  "project.assessment_state",
  "project.question_bank_version",
  "project.created_at",
  "project.completed_at",
  "project.premium_ever_activated",
  "project.premium_access_active",
  "project.subscription_status",
  "project.precision_state",
  "project.premium_requested_at",
  "company.name",
  "company.website",
  "person.first_name",
  "person.last_name",
  "person.email",
  "person.interface_language",
  ...Object.values(PROFILE_FIELDS),
  "snapshot.defined_count",
  "snapshot.needs_attention_count",
  "snapshot.resolve_early_count",
  "event.type",
  "event.occurred_at",
] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export function isSourceKey(value: unknown): value is SourceKey {
  return typeof value === "string" && (SOURCE_KEYS as readonly string[]).includes(value);
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export async function loadSourceRecord(db: Db, event: OutboundEvent): Promise<Record<SourceKey, SourceValue> | null> {
  if (!event.projectId) return null;
  const { rows } = await db.query<{
    project_id: string;
    assessment_state: string;
    question_bank_version: string;
    created_at: Date;
    completed_at: Date | null;
    premium_ever_activated: boolean;
    precision_state: string;
    premium_access_active: boolean | null;
    subscription_status: string | null;
    premium_requested_at: Date | null;
    company_name: string;
    company_website: string | null;
    first_name: string;
    last_name: string;
    primary_email: string;
    interface_language: string;
  }>(
    `SELECT p.project_id, p.assessment_state::text AS assessment_state, p.question_bank_version, p.created_at, l.completed_at,
            p.premium_ever_activated, p.precision_state::text AS precision_state, e.premium_access_active,
            (SELECT s.status::text FROM subscription s WHERE s.project_id = p.project_id ORDER BY s.created_at DESC, s.current_period_start DESC LIMIT 1) AS subscription_status,
            (SELECT max(r.requested_at) FROM premium_activation_request r WHERE r.project_id = p.project_id) AS premium_requested_at,
            c.name AS company_name, c.website AS company_website, pe.first_name, pe.last_name, pe.primary_email, pe.interface_language
       FROM project p
       JOIN company c ON c.company_id = p.company_id
       JOIN person pe ON pe.person_id = p.created_by_person_id
       LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE p.project_id = $1`,
    [event.projectId],
  );
  const p = rows[0];
  if (!p || p.assessment_state === "DELETED") return null;

  const answers = await db.query<{ field_key: string; value: unknown }>(
    "SELECT field_key, value FROM answer WHERE project_id = $1 AND superseded_by IS NULL AND field_key = ANY($2::text[])",
    [event.projectId, Object.values(PROFILE_FIELDS)],
  );
  const answer = new Map(answers.rows.map((a) => [a.field_key, a.value]));
  const findings = await db.query<{ status: string; n: number }>(
    "SELECT status::text AS status, count(*)::int AS n FROM finding WHERE project_id = $1 GROUP BY status",
    [event.projectId],
  );
  const findingCount = (status: string) => findings.rows.find((f) => f.status === status)?.n ?? 0;
  const enumeration = (value: unknown): SourceValue =>
    typeof value === "string" ? value : Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
  const completed = p.assessment_state === "COMPLETED_LOCKED";

  const record: Record<SourceKey, SourceValue> = {
    "project.id": p.project_id,
    "project.assessment_state": p.assessment_state,
    "project.question_bank_version": p.question_bank_version,
    "project.created_at": iso(p.created_at),
    "project.completed_at": iso(p.completed_at),
    "project.premium_ever_activated": p.premium_ever_activated,
    "project.premium_access_active": p.premium_access_active === true,
    "project.subscription_status": p.subscription_status,
    "project.precision_state": p.precision_state,
    "project.premium_requested_at": iso(p.premium_requested_at),
    "company.name": p.company_name,
    "company.website": p.company_website,
    "person.first_name": p.first_name,
    "person.last_name": p.last_name,
    "person.email": p.primary_email,
    "person.interface_language": p.interface_language,
    "fa.goal.primary_goal": enumeration(answer.get(PROFILE_FIELDS.primaryGoal)),
    "fa.project.stage": enumeration(answer.get(PROFILE_FIELDS.projectStage)),
    "fa.project.destination_status": enumeration(answer.get(PROFILE_FIELDS.destinationStatus)),
    "fa.business.type": enumeration(answer.get(PROFILE_FIELDS.businessType)),
    "fa.project.target_markets": enumeration(answer.get(PROFILE_FIELDS.targetMarkets)),
    "fa.operation.expected_capabilities": enumeration(answer.get(PROFILE_FIELDS.expectedCapabilities)),
    "fa.operation.components": enumeration(answer.get(PROFILE_FIELDS.operationComponents)),
    "snapshot.defined_count": completed ? findingCount("DEFINED") : null,
    "snapshot.needs_attention_count": completed ? findingCount("NEEDS_ATTENTION") : null,
    "snapshot.resolve_early_count": completed ? findingCount("CRITICAL_GAP") : null,
    "event.type": event.eventType,
    "event.occurred_at": event.occurredAt.toISOString(),
  };
  return record;
}
