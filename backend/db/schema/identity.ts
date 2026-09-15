import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_normalized_domain_idx").on(t.normalizedDomain),
    index("company_name_idx").on(t.name),
    index("company_normalized_name_idx").on(t.normalizedName),
    index("company_email_domain_idx").on(t.emailDomain),
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
