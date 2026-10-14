import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, AnyPgColumn, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { company } from "./identity";
import { adminUser } from "./ops";
import { project } from "./project";

/**
 * Premium entitlement foundation. Premium is a VALID BEESIDE ENTITLEMENT, not "a Stripe subscription".
 *
 * An entitlement is derived from ACCESS SOURCES, read through `entitlement_sources_for()` (migration 0028):
 *   - `paid`: the existing `subscription` rows (the provider-agnostic paid lifecycle that Stripe / the dev simulation /
 *     manual injection drive through `processSubscriptionEvent`).
 *   - every other source (`complimentary`, `promotion`, `trial`, `manual`, `partner`, `sponsored`): rows of `entitlement_grant`.
 * `entitlement` (the row Precision reads) is a PROJECTION of all sources, recomputed by `entitlement_recompute()`.
 *
 * PROJECT FIRST. A grant targets one project. A company-level grant is an explicit agreement with an explicit scope
 * (`current_projects` = projects that already existed when it was issued; `projects_created_in_period` = projects created
 * during its window) and an optional cap (`max_projects`). Nothing is ever inferred as "all projects of this company, forever".
 *
 * RULE vs EXCEPTION. An `entitlement_program` is a RULE (kind, market, window, cap, days, optional named eligibility, and for
 * `sponsored` the sponsor who pays). Redeeming it creates a grant that cites it. An exception is a grant made directly, with a
 * mandatory reason and approver. Grants are never deleted or rewritten: extending = a new chained grant, ending early =
 * a write-once termination with its reason.
 *
 * GOVERNANCE (V1.0): an individual project exception may be approved by an ADMIN; anything broad (a program, a sponsor,
 * a company-level grant, a grant that cites a program) needs a SUPER_ADMIN approver. Enforced by the database.
 *
 * PRIVACY is separate from commerce: `project_privacy_event` is an append-only ledger whose latest state can block access
 * whatever the entitlement says (see `project_privacy_state`).
 */

export const GRANT_SOURCES = ["complimentary", "promotion", "trial", "manual", "partner", "sponsored"] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const PROGRAM_KINDS = ["promotion", "trial", "partner", "sponsored"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];

export const PROGRAM_STATUSES = ["draft", "active", "closed"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const SPONSOR_KINDS = ["government", "agency", "chamber", "accelerator", "corporate", "other"] as const;
export type SponsorKind = (typeof SPONSOR_KINDS)[number];

export const COMPANY_SCOPES = ["current_projects", "projects_created_in_period"] as const;
export type CompanyScope = (typeof COMPANY_SCOPES)[number];

export const PRIVACY_EVENTS = ["access_blocked", "access_restored", "anonymized"] as const;
export type PrivacyEventName = (typeof PRIVACY_EVENTS)[number];

export const PRIVACY_REASONS = ["erasure_request", "legal_order", "contract_closure", "security_action", "other"] as const;
export type PrivacyReason = (typeof PRIVACY_REASONS)[number];

/** The institution that pays beeside so that selected companies get Premium (embassy, agency, chamber, accelerator...). */
export const sponsor = pgTable(
  "sponsor",
  {
    sponsorId: uuid("sponsor_id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** ISO 3166-1 alpha-2 of the institution's country, when it has one. */
    country: text("country"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull().references(() => adminUser.adminUserId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sponsor_name_unique").on(sql`lower(${t.name})`),
    check("sponsor_kind", sql`${t.kind} IN ('government', 'agency', 'chamber', 'accelerator', 'corporate', 'other')`),
    check("sponsor_status", sql`${t.status} IN ('active', 'inactive')`),
    check("sponsor_country", sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`),
    check("sponsor_name", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const entitlementProgram = pgTable(
  "entitlement_program",
  {
    programId: uuid("program_id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** Required for `sponsored`, forbidden otherwise: the payer is not the user. */
    sponsorId: uuid("sponsor_id").references(() => sponsor.sponsorId),
    /** Reference to the agreement/contract outside this system. */
    agreementRef: text("agreement_ref"),
    /** ISO 3166-1 alpha-2 codes the program applies to; NULL = no market restriction. */
    marketScope: text("market_scope").array(),
    /** Length of the access one redemption grants. */
    grantDays: integer("grant_days").notNull(),
    /** Redemption window. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Beneficiary cap (number of redemptions = projects). NULL = unlimited. */
    maxRedemptions: integer("max_redemptions"),
    /** `open` = any project in scope; `listed` = only companies named in entitlement_program_eligibility. */
    eligibility: text("eligibility").notNull().default("open"),
    status: text("status").notNull().default("draft"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => adminUser.adminUserId),
    approvedBy: uuid("approved_by").references(() => adminUser.adminUserId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("entitlement_program_code_unique").on(t.code),
    check("entitlement_program_code_format", sql`${t.code} ~ '^[a-z0-9][a-z0-9_-]{2,40}$'`),
    check("entitlement_program_kind", sql`${t.kind} IN ('promotion', 'trial', 'partner', 'sponsored')`),
    check("entitlement_program_status", sql`${t.status} IN ('draft', 'active', 'closed')`),
    check("entitlement_program_eligibility", sql`${t.eligibility} IN ('open', 'listed')`),
    check("entitlement_program_sponsor", sql`(${t.kind} = 'sponsored') = (${t.sponsorId} IS NOT NULL)`),
    check("entitlement_program_grant_days", sql`${t.grantDays} BETWEEN 1 AND 3650`),
    check("entitlement_program_window", sql`${t.endsAt} > ${t.startsAt}`),
    check("entitlement_program_quota", sql`${t.maxRedemptions} IS NULL OR ${t.maxRedemptions} > 0`),
    check("entitlement_program_market_nonempty", sql`${t.marketScope} IS NULL OR cardinality(${t.marketScope}) > 0`),
    check("entitlement_program_reason", sql`length(btrim(${t.reason})) > 0`),
    // A program cannot be active without an approver (governed source).
    check("entitlement_program_active_is_approved", sql`${t.status} = 'draft' OR ${t.approvedBy} IS NOT NULL`),
    check("entitlement_program_closed_coherent", sql`(${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`),
  ],
);

/** Companies a `listed` program may serve (the sponsor's selection). Append-only. */
export const entitlementProgramEligibility = pgTable(
  "entitlement_program_eligibility",
  {
    programId: uuid("program_id").notNull().references(() => entitlementProgram.programId),
    companyId: uuid("company_id").notNull().references(() => company.companyId),
    createdBy: uuid("created_by").notNull().references(() => adminUser.adminUserId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.programId, t.companyId] })],
);

export const entitlementGrant = pgTable(
  "entitlement_grant",
  {
    grantId: uuid("grant_id").primaryKey().default(sql`gen_random_uuid()`),
    /** Exactly one of project_id / company_id. */
    projectId: uuid("project_id").references(() => project.projectId),
    companyId: uuid("company_id").references(() => company.companyId),
    /** Required for a company grant (and forbidden for a project grant): which of the company's projects it covers. */
    companyScope: text("company_scope"),
    /** Company grant only: cap on covered projects (earliest created first). NULL = no cap inside the scope. */
    maxProjects: integer("max_projects"),
    source: text("source").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Evidence of the market (ISO alpha-2 codes) the grant was issued for; informational for audit. */
    marketScope: text("market_scope").array(),
    programId: uuid("program_id").references(() => entitlementProgram.programId),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => adminUser.adminUserId),
    /** Who created it: an admin (`admin:<uuid>`) or a Core job (`system:<name>`). */
    createdByActor: text("created_by_actor").notNull(),
    /** The grant this one extends (never edited in place). */
    extendsGrantId: uuid("extends_grant_id").references((): AnyPgColumn => entitlementGrant.grantId),
    idempotencyKey: text("idempotency_key"),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    terminatedBy: uuid("terminated_by").references(() => adminUser.adminUserId),
    terminationReason: text("termination_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entitlement_grant_project_idx").on(t.projectId, t.startsAt),
    index("entitlement_grant_company_idx").on(t.companyId, t.startsAt),
    index("entitlement_grant_program_idx").on(t.programId),
    uniqueIndex("entitlement_grant_idempotency_unique").on(t.idempotencyKey),
    // A program is redeemed at most once per project and once per company.
    uniqueIndex("entitlement_grant_program_project_unique").on(t.programId, t.projectId).where(sql`${t.programId} IS NOT NULL AND ${t.projectId} IS NOT NULL`),
    uniqueIndex("entitlement_grant_program_company_unique").on(t.programId, t.companyId).where(sql`${t.programId} IS NOT NULL AND ${t.companyId} IS NOT NULL`),
    check("entitlement_grant_scope", sql`(${t.projectId} IS NULL) <> (${t.companyId} IS NULL)`),
    check("entitlement_grant_company_scope", sql`(${t.companyId} IS NULL) = (${t.companyScope} IS NULL)`),
    check("entitlement_grant_company_scope_values", sql`${t.companyScope} IS NULL OR ${t.companyScope} IN ('current_projects', 'projects_created_in_period')`),
    check("entitlement_grant_max_projects", sql`${t.maxProjects} IS NULL OR (${t.companyId} IS NOT NULL AND ${t.maxProjects} > 0)`),
    check("entitlement_grant_source", sql`${t.source} IN ('complimentary', 'promotion', 'trial', 'manual', 'partner', 'sponsored')`),
    check("entitlement_grant_window", sql`${t.endsAt} > ${t.startsAt}`),
    check("entitlement_grant_reason", sql`length(btrim(${t.reason})) > 0`),
    // Program-based sources cite their program; the others never do. promotion and sponsored MUST.
    check("entitlement_grant_program_source", sql`(${t.source} IN ('promotion', 'trial', 'partner', 'sponsored')) OR ${t.programId} IS NULL`),
    check("entitlement_grant_program_required", sql`${t.source} NOT IN ('promotion', 'sponsored') OR ${t.programId} IS NOT NULL`),
    check("entitlement_grant_market_nonempty", sql`${t.marketScope} IS NULL OR cardinality(${t.marketScope}) > 0`),
    check("entitlement_grant_termination_coherent", sql`(${t.terminatedAt} IS NULL) = (${t.terminationReason} IS NULL) AND (${t.terminatedAt} IS NULL) = (${t.terminatedBy} IS NULL)`),
    check("entitlement_grant_terminated_after_start", sql`${t.terminatedAt} IS NULL OR ${t.terminatedAt} >= ${t.startsAt}`),
    check("entitlement_grant_not_self_extension", sql`${t.extendsGrantId} IS NULL OR ${t.extendsGrantId} <> ${t.grantId}`),
  ],
);

/**
 * Privacy / data-lifecycle ledger (append-only). Independent of entitlement: "paid until date X" never means beeside may keep
 * serving or retaining data when a valid legal/privacy requirement says otherwise. The legal rules and the anonymization itself
 * belong to Privacy/Admin; this is only the boundary Precision and Core obey. No free text (no personal data) is stored here.
 */
export const projectPrivacyEvent = pgTable(
  "project_privacy_event",
  {
    eventId: uuid("event_id").primaryKey().default(sql`gen_random_uuid()`),
    /** Strict order of events (several can share a timestamp). */
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    event: text("event").notNull(),
    reasonCode: text("reason_code").notNull(),
    /** `admin:<uuid>` or `system:<name>`. */
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_privacy_event_project_idx").on(t.projectId, t.createdAt),
    check("project_privacy_event_name", sql`${t.event} IN ('access_blocked', 'access_restored', 'anonymized')`),
    check("project_privacy_event_reason", sql`${t.reasonCode} IN ('erasure_request', 'legal_order', 'contract_closure', 'security_action', 'other')`),
    check("project_privacy_event_actor", sql`length(btrim(${t.actor})) > 0`),
  ],
);
