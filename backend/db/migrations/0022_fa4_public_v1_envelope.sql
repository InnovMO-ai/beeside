ALTER TABLE "fa4_result" ADD COLUMN "rules_version" text;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD COLUMN "source_schema_version" integer;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD COLUMN "resolution_schema_version" integer;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD COLUMN "resolution_snapshot" jsonb;--> statement-breakpoint
-- Rows that exist today were written before Public v1.0: they were PREVIEWS stored as results. They are flagged legacy (fast default: no UPDATE, so
-- the append-only guard is untouched) and are NEVER back-filled from the mutable answers; only rows written from now on are sealed envelopes.
ALTER TABLE "fa4_result" ADD COLUMN "legacy_unsealed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "fa4_result" ALTER COLUMN "legacy_unsealed" SET DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_result_one_sealed_per_project" ON "fa4_result" USING btree ("project_id") WHERE NOT "fa4_result"."legacy_unsealed";--> statement-breakpoint
ALTER TABLE "fa4_result" ADD CONSTRAINT "fa4_result_sealed_envelope" CHECK ("fa4_result"."legacy_unsealed" OR ("fa4_result"."rules_version" IS NOT NULL AND "fa4_result"."source_schema_version" IS NOT NULL AND "fa4_result"."source_snapshot" IS NOT NULL AND "fa4_result"."resolution_schema_version" IS NOT NULL AND "fa4_result"."resolution_snapshot" IS NOT NULL AND jsonb_typeof("fa4_result"."source_snapshot") = 'object' AND jsonb_typeof("fa4_result"."resolution_snapshot") = 'object'));--> statement-breakpoint
-- A project is DELIVERED only through an explicit delivery (sealed result). Projects that were marked DELIVERED merely because a preview had been stored go back to IN_PROGRESS.
UPDATE "fa4_project" SET "status" = 'IN_PROGRESS' WHERE "status" = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "fa4_result" r WHERE r."project_id" = "fa4_project"."project_id" AND NOT r."legacy_unsealed");
