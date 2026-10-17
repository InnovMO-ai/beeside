import { check, pgTable, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Data-domain ownership of every table in the ONE canonical database (shared by Discovery and Precision Center).
 * The registry rows, the roles and the grant function live in the custom migration `db_domain_registry_integrity` (SQL); this is the table.
 *
 *   DISCOVERY — written by the Discovery runtime (its own product data and catalog);
 *   PLATFORM  — infrastructure both runtimes use with explicitly limited privileges (e.g. the shared rate-limit counters);
 *   PRECISION — everything else: Precision Center, operator console, commercial, knowledge, privacy and shared identity.
 *
 * `discovery_privileges` is the exact set of table privileges (letters of SELECT / INSERT / UPDATE / DELETE) the Discovery runtime group
 * holds on the table. Anything not listed is inaccessible to Discovery: a new table is closed to Discovery until it is registered.
 */
export const dbDomainRegistry = pgTable(
  "db_domain_registry",
  {
    tableName: text("table_name").primaryKey(),
    domain: text("domain").notNull(),
    discoveryPrivileges: text("discovery_privileges").notNull().default(""),
  },
  (t) => [
    check("db_domain_registry_domain", sql`${t.domain} IN ('DISCOVERY', 'PLATFORM', 'PRECISION')`),
    check("db_domain_registry_privileges", sql`${t.discoveryPrivileges} ~ '^S?I?U?D?$'`),
    check("db_domain_registry_precision_closed", sql`${t.domain} <> 'PRECISION' OR ${t.discoveryPrivileges} = ''`),
  ],
);
