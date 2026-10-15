import { AnyPgColumn, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const company = pgTable(
  "company",
  {
    companyId: uuid("company_id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    website: text("website"),
    // Company matching signals (recognition only — companies are never auto-merged):
    // normalized_domain = website host; email_domain = corporate domain after '@' of the work
    // email (NULL for personal-mail domains); normalized_name = casefolded, punctuation-free name.
    normalizedDomain: text("normalized_domain"),
    normalizedName: text("normalized_name"),
    emailDomain: text("email_domain"),
    // Company lifecycle (identity continuity contract): ACTIVE, PROVISIONAL (probable match awaiting review, never auto-merged) or
    // MERGED (an operator confirmed it is the same company as merged_into_company_id; the row is kept, never deleted).
    status: text("status").notNull().default("ACTIVE"),
    mergedIntoCompanyId: uuid("merged_into_company_id").references((): AnyPgColumn => company.companyId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_normalized_domain_idx").on(t.normalizedDomain),
    index("company_name_idx").on(t.name),
    index("company_normalized_name_idx").on(t.normalizedName),
    index("company_email_domain_idx").on(t.emailDomain),
    check("company_status", sql`${t.status} IN ('ACTIVE','PROVISIONAL','MERGED')`),
    check("company_merged_consistency", sql`(${t.status} = 'MERGED') = (${t.mergedIntoCompanyId} IS NOT NULL)`),
  ],
);

/** Who belongs to a company (many-to-many). A link is created only from evidence (a verified person in a governed flow); it is never inferred from a name. */
export const companyPerson = pgTable(
  "company_person",
  {
    companyPersonId: uuid("company_person_id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => company.companyId),
    personId: uuid("person_id").notNull().references(() => person.personId),
    status: text("status").notNull(),
    role: text("role").notNull(),
    /** What created the link: the promotion source, e.g. discovery_promotion:manual. */
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_person_unique").on(t.companyId, t.personId),
    index("company_person_person_idx").on(t.personId),
    check("company_person_status", sql`${t.status} IN ('ACTIVE','INVITED','PENDING_REVIEW','REVOKED')`),
    check("company_person_role", sql`${t.role} IN ('OWNER','MEMBER')`),
  ],
);

/** A PROBABLE company match that a person must confirm or reject. Never blocks an entitlement and never merges by itself. */
export const companyMatchReview = pgTable(
  "company_match_review",
  {
    reviewId: uuid("review_id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => company.companyId),
    candidateCompanyId: uuid("candidate_company_id").notNull().references(() => company.companyId),
    signal: text("signal").notNull(),
    status: text("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("company_match_review_pair_unique").on(t.companyId, t.candidateCompanyId),
    check("company_match_review_signal", sql`${t.signal} IN ('NORMALIZED_NAME','EMAIL_DOMAIN','NAME_AND_DOMAIN')`),
    check("company_match_review_status", sql`${t.status} IN ('OPEN','CONFIRMED_SAME','CONFIRMED_DISTINCT')`),
    check("company_match_review_distinct", sql`${t.companyId} <> ${t.candidateCompanyId}`),
  ],
);

export const person = pgTable(
  "person",
  {
    personId: uuid("person_id").primaryKey().default(sql`gen_random_uuid()`),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    // Stored normalized (trim + lowercase) by the application before insert.
    primaryEmail: text("primary_email").notNull(),
    interfaceLanguage: text("interface_language").notNull(),
    preferredInteractionLanguage: text("preferred_interaction_language").notNull(),
    preferredDeliverableLanguage: text("preferred_deliverable_language").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("person_primary_email_unique").on(t.primaryEmail)],
);
