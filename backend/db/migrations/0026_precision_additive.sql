ALTER TYPE "public"."fact_answer_state" ADD VALUE 'ASSUMED';--> statement-breakpoint
CREATE TABLE "context_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_project_id" uuid NOT NULL,
	"source_result_id" uuid NOT NULL,
	"catalog_version" text NOT NULL,
	"contract_version" text NOT NULL,
	"crosswalk_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"superseded_by_pin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_pin_source_system" CHECK ("context_pin"."source_system" = 'fa4'),
	CONSTRAINT "context_pin_status" CHECK ("context_pin"."status" IN ('current','superseded')),
	CONSTRAINT "context_pin_superseded_coherent" CHECK (("context_pin"."status" = 'superseded') = ("context_pin"."superseded_by_pin_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "oh_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "oh_delivery_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pack_id" uuid,
	"snapshot_id" uuid,
	"artifact_version" integer NOT NULL,
	"status" text NOT NULL,
	"oh_reference" text,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oh_delivery_kind" CHECK ("oh_delivery"."kind" IN ('crp','psm','update_note')),
	CONSTRAINT "oh_delivery_status" CHECK ("oh_delivery"."status" IN ('queued','delivered','failed')),
	CONSTRAINT "oh_delivery_artifact_version" CHECK ("oh_delivery"."artifact_version" >= 1),
	CONSTRAINT "oh_delivery_kind_artifact" CHECK (("oh_delivery"."kind" IN ('crp','update_note') AND "oh_delivery"."pack_id" IS NOT NULL AND "oh_delivery"."snapshot_id" IS NULL) OR ("oh_delivery"."kind" = 'psm' AND "oh_delivery"."snapshot_id" IS NOT NULL AND "oh_delivery"."pack_id" IS NULL)),
	CONSTRAINT "oh_delivery_error_only_failed" CHECK (("oh_delivery"."status" = 'failed') = ("oh_delivery"."error_code" IS NOT NULL)),
	CONSTRAINT "oh_delivery_error_code_format" CHECK ("oh_delivery"."error_code" IS NULL OR "oh_delivery"."error_code" ~ '^[A-Z0-9_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "category_assessment" DROP CONSTRAINT "category_assessment_category_key_format";--> statement-breakpoint
ALTER TABLE "category_manifest_version" DROP CONSTRAINT "category_manifest_version_category_key_format";--> statement-breakpoint
ALTER TABLE "category_assessment" DROP CONSTRAINT "category_assessment_manifest_version_fk";
--> statement-breakpoint
ALTER TABLE "category_assessment" ADD COLUMN "manifest_category_key" text GENERATED ALWAYS AS (CASE WHEN category_key LIKE 'new:%' THEN '_generic' ELSE category_key END) STORED;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "source_pin_id" uuid;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN "source_item_ref" text;--> statement-breakpoint
ALTER TABLE "context_pin" ADD CONSTRAINT "context_pin_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOTE: context_pin_superseded_same_project_fk is created (DEFERRABLE) in 0020, after the unique index it references.
ALTER TABLE "oh_delivery" ADD CONSTRAINT "oh_delivery_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_delivery" ADD CONSTRAINT "oh_delivery_pack_id_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_delivery" ADD CONSTRAINT "oh_delivery_snapshot_id_service_map_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."service_map_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_pin_id_project_unique" ON "context_pin" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_pin_one_current" ON "context_pin" USING btree ("project_id") WHERE "context_pin"."status" = 'current';--> statement-breakpoint
CREATE UNIQUE INDEX "context_pin_project_result_unique" ON "context_pin" USING btree ("project_id","source_result_id");--> statement-breakpoint
CREATE INDEX "context_pin_project_idx" ON "context_pin" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "oh_delivery_project_idx" ON "oh_delivery" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oh_delivery_idem_status_unique" ON "oh_delivery" USING btree ("idempotency_key","status");--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_manifest_version_fk" FOREIGN KEY ("manifest_category_key","manifest_version") REFERENCES "public"."category_manifest_version"("category_key","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_pin_id_context_pin_id_fk" FOREIGN KEY ("source_pin_id") REFERENCES "public"."context_pin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_category_key_format" CHECK ("category_assessment"."category_key" ~ '^(new:[a-z][a-z0-9_]{1,63}|[a-z][a-z0-9_]{1,63})$');--> statement-breakpoint
ALTER TABLE "category_manifest_version" ADD CONSTRAINT "category_manifest_version_category_key_format" CHECK ("category_manifest_version"."category_key" ~ '^(_generic|[a-z][a-z0-9_]{1,63})$');--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_item_requires_pin" CHECK ("fact"."source_item_ref" IS NULL OR "fact"."source_pin_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_item_ref_format" CHECK ("fact"."source_item_ref" IS NULL OR "fact"."source_item_ref" ~ '^[A-Za-z0-9_.:-]{1,80}$');