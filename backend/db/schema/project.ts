import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { actorTypeEnum, assessmentStateEnum, precisionStateEnum, trustStateEnum } from "./enums";
import { company } from "./identity";
import { person } from "./identity";
import { questionBankVersion, rulesEngineVersion, snapshotTemplateVersion } from "./reference";
// Cross-file reference to admin_user (defined in ops.ts, which itself imports `project`
// from this file for its own FKs). This is a circular ES-module import, which is safe here
// because every reference on both sides is wrapped in a `() => ...` thunk (see
// `.references()` below) — Drizzle never evaluates it until both modules have finished
// loading, which is the standard pattern for cross-file relations in a multi-file schema.
import { adminUser } from "./ops";

export const project = pgTable(
  "project",
  {
    projectId: uuid("project_id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => company.companyId),
    createdByPersonId: uuid("created_by_person_id").notNull().references(() => person.personId),
    responsiblePersonId: uuid("responsible_person_id").notNull().references(() => person.personId),
    assessmentState: assessmentStateEnum("assessment_state").notNull().default("DRAFT"),
    trustState: trustStateEnum("trust_state").notNull().default("NORMAL"),
    lastCompletedStep: text("last_completed_step"),
    questionBankVersion: text("question_bank_version").notNull().references(() => questionBankVersion.version),
    rulesEngineVersion: text("rules_engine_version").notNull().references(() => rulesEngineVersion.version),
    snapshotTemplateVersion: text("snapshot_template_version").notNull().references(() => snapshotTemplateVersion.version),
    extensionRequested: boolean("extension_requested").notNull().default(false),
    premiumEverActivated: boolean("premium_ever_activated").notNull().default(false),
    premiumFirstActivatedAt: timestamp("premium_first_activated_at", { withTimezone: true }),
    precisionState: precisionStateEnum("precision_state").notNull().default("NOT_STARTED"),
    precisionStartedAt: timestamp("precision_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_company_id_idx").on(t.companyId),
    index("project_assessment_state_idx").on(t.assessmentState),
    index("project_assessment_state_premium_idx").on(t.assessmentState, t.premiumEverActivated),
    check(
      "project_premium_first_activated_consistency",
      sql`${t.premiumFirstActivatedAt} IS NULL OR ${t.premiumEverActivated} = true`,
    ),
    check(
      "project_precision_started_consistency",
      sql`${t.precisionStartedAt} IS NULL OR ${t.precisionState} = 'STARTED'`,
    ),
  ],
);

// Fully actor-attributed audit trail for reassigning project.responsible_person_id.
// Rows are inserted exclusively by the reassign_project_responsibility() SQL function
// (0001_integrity_triggers.sql), which is the ONLY sanctioned way to change
// project.responsible_person_id — a guard on `project` rejects any direct UPDATE that
// doesn't go through it. actor_type discriminates which of actor_person_id /
// actor_admin_user_id is populated (enforced by a CHECK constraint below); both are NULL
// only when actor_type = 'SYSTEM'. Application code should call the SQL function (e.g.
// via `sql\`select reassign_project_responsibility(...)\`` in Drizzle) rather than
// writing to this table or to project.responsible_person_id directly.
export const projectResponsibilityChange = pgTable(
  "project_responsibility_change",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    previousResponsiblePersonId: uuid("previous_responsible_person_id").references(() => person.personId),
    newResponsiblePersonId: uuid("new_responsible_person_id").notNull().references(() => person.personId),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorPersonId: uuid("actor_person_id").references(() => person.personId),
    actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUser.adminUserId),
  },
  (t) => [
    index("project_responsibility_change_project_idx").on(t.projectId, t.changedAt),
    check(
      "project_responsibility_change_actor_consistency",
      sql`(${t.actorType} = 'PERSON' AND ${t.actorPersonId} IS NOT NULL AND ${t.actorAdminUserId} IS NULL)
       OR (${t.actorType} = 'ADMIN_USER' AND ${t.actorAdminUserId} IS NOT NULL AND ${t.actorPersonId} IS NULL)
       OR (${t.actorType} = 'SYSTEM' AND ${t.actorPersonId} IS NULL AND ${t.actorAdminUserId} IS NULL)`,
    ),
  ],
);
