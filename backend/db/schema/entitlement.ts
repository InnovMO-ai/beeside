import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { company } from "./identity";
import { adminUser } from "./ops";
import { project } from "./project";

/**
 * Premium entitlement foundation (Macroblock C). Premium is a VALID BEESIDE ENTITLEMENT, not "a Stripe subscription".
 *
 * An entitlement is derived from ACCESS SOURCES, read through the `premium_access_source` view (migration 0028):
 *   - `paid`: the existing `subscription` rows (the provider-agnostic paid-period lifecycle that Stripe / the dev
 *     simulation / manual injection drive through `processSubscriptionEvent`). Nothing about paid access moved.
 *   - every other source (`complimentary`, `promotion`, `trial`, `manual`, `partner`): rows of `entitlement_grant`.
 * `entitlement` (the row Precision reads) is a PROJECTION of all sources, recomputed by `entitlement_recompute()`.
 *
 * Grants are never deleted or rewritten. Extending = a new grant that points at the one it extends; ending early =
 * a write-once termination with its reason. A grant that is not paid always carries a reason and an approver.
 *
 * PROMOTION vs EXCEPTION: a `promotion_campaign` is a RULE (market, window, quota, days). Redeeming it creates a grant
 * that cites it. An exception is a grant made directly to one project or company, with no campaign.
 */

export const GRANT_SOURCES = ["complimentary", "promotion", "trial", "manual", "partner"] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const CAMPAIGN_KINDS = ["promotion", "trial", "partner"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "closed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const promotionCampaign = pgTable(
  "promotion_campaign",
  {
    campaignId: uuid("campaign_id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** ISO 3166-1 alpha-2 codes the campaign applies to; NULL = no market restriction. */
    marketScope: text("market_scope").array(),
    /** Length of the access one redemption grants. */
    grantDays: integer("grant_days").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** NULL = unlimited. */
    maxRedemptions: integer("max_redemptions"),
    status: text("status").notNull().default("draft"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => adminUser.adminUserId),
    approvedBy: uuid("approved_by").references(() => adminUser.adminUserId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("promotion_campaign_code_unique").on(t.code),
    check("promotion_campaign_code_format", sql`${t.code} ~ '^[a-z0-9][a-z0-9_-]{2,40}$'`),
    check("promotion_campaign_kind", sql`${t.kind} IN ('promotion', 'trial', 'partner')`),
    check("promotion_campaign_status", sql`${t.status} IN ('draft', 'active', 'closed')`),
    check("promotion_campaign_grant_days", sql`${t.grantDays} BETWEEN 1 AND 3650`),
    check("promotion_campaign_window", sql`${t.endsAt} > ${t.startsAt}`),
    check("promotion_campaign_quota", sql`${t.maxRedemptions} IS NULL OR ${t.maxRedemptions} > 0`),
    check("promotion_campaign_market_nonempty", sql`${t.marketScope} IS NULL OR cardinality(${t.marketScope}) > 0`),
    check("promotion_campaign_reason", sql`length(btrim(${t.reason})) > 0`),
    // A campaign cannot be active without an approver (governed source).
    check("promotion_campaign_active_is_approved", sql`${t.status} = 'draft' OR ${t.approvedBy} IS NOT NULL`),
    check("promotion_campaign_closed_coherent", sql`(${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`),
  ],
);

export const entitlementGrant = pgTable(
  "entitlement_grant",
  {
    grantId: uuid("grant_id").primaryKey().default(sql`gen_random_uuid()`),
    /** Exactly one of project_id / company_id: a company grant covers its current and future projects. */
    projectId: uuid("project_id").references(() => project.projectId),
    companyId: uuid("company_id").references(() => company.companyId),
    source: text("source").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Evidence of the market (ISO alpha-2 codes) the grant was issued for; informational for audit. */
    marketScope: text("market_scope").array(),
    campaignId: uuid("campaign_id").references(() => promotionCampaign.campaignId),
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
    index("entitlement_grant_campaign_idx").on(t.campaignId),
    uniqueIndex("entitlement_grant_idempotency_unique").on(t.idempotencyKey),
    // A campaign is redeemed at most once per project and once per company.
    uniqueIndex("entitlement_grant_campaign_project_unique").on(t.campaignId, t.projectId).where(sql`${t.campaignId} IS NOT NULL AND ${t.projectId} IS NOT NULL`),
    uniqueIndex("entitlement_grant_campaign_company_unique").on(t.campaignId, t.companyId).where(sql`${t.campaignId} IS NOT NULL AND ${t.companyId} IS NOT NULL`),
    check("entitlement_grant_scope", sql`(${t.projectId} IS NULL) <> (${t.companyId} IS NULL)`),
    check("entitlement_grant_source", sql`${t.source} IN ('complimentary', 'promotion', 'trial', 'manual', 'partner')`),
    check("entitlement_grant_window", sql`${t.endsAt} > ${t.startsAt}`),
    check("entitlement_grant_reason", sql`length(btrim(${t.reason})) > 0`),
    // A campaign-based source must cite its campaign; the others never do.
    check("entitlement_grant_campaign_source", sql`(${t.source} IN ('promotion', 'trial', 'partner')) OR ${t.campaignId} IS NULL`),
    check("entitlement_grant_promotion_has_campaign", sql`${t.source} <> 'promotion' OR ${t.campaignId} IS NOT NULL`),
    check("entitlement_grant_market_nonempty", sql`${t.marketScope} IS NULL OR cardinality(${t.marketScope}) > 0`),
    check("entitlement_grant_termination_coherent", sql`(${t.terminatedAt} IS NULL) = (${t.terminationReason} IS NULL) AND (${t.terminatedAt} IS NULL) = (${t.terminatedBy} IS NULL)`),
    check("entitlement_grant_terminated_after_start", sql`${t.terminatedAt} IS NULL OR ${t.terminatedAt} >= ${t.startsAt}`),
    check("entitlement_grant_not_self_extension", sql`${t.extendsGrantId} IS NULL OR ${t.extendsGrantId} <> ${t.grantId}`),
  ],
);
