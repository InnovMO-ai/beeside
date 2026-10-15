CREATE TABLE "privacy_erasure_registry" (
	"table_name" text PRIMARY KEY NOT NULL,
	"data_class" text NOT NULL,
	"action" text NOT NULL,
	"erase_order" integer,
	"project_predicate" text,
	"reason" text,
	CONSTRAINT "privacy_registry_action" CHECK ("privacy_erasure_registry"."action" IN ('erase', 'erase_if_policy', 'anonymize', 'keep', 'global', 'other_mechanism')),
	CONSTRAINT "privacy_registry_order" CHECK (("privacy_erasure_registry"."action" IN ('erase', 'erase_if_policy')) = ("privacy_erasure_registry"."erase_order" IS NOT NULL)),
	CONSTRAINT "privacy_registry_reason" CHECK ("privacy_erasure_registry"."action" IN ('erase') OR "privacy_erasure_registry"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "privacy_erasure_run" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"policy_id" uuid,
	"actor" text NOT NULL,
	"outcome" text NOT NULL,
	"refusal_reason" text,
	"deleted_rows" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"person_anonymized" boolean DEFAULT false NOT NULL,
	"company_anonymized" boolean DEFAULT false NOT NULL,
	"external_followups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_run_outcome" CHECK ("privacy_erasure_run"."outcome" IN ('completed', 'refused')),
	CONSTRAINT "privacy_run_refusal" CHECK (("privacy_erasure_run"."outcome" = 'refused') = ("privacy_erasure_run"."refusal_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "privacy_policy" (
	"policy_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer GENERATED ALWAYS AS IDENTITY (sequence name "privacy_policy_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" text DEFAULT 'approved' NOT NULL,
	"min_days_after_block" integer NOT NULL,
	"retain_legal_acceptance" boolean NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "privacy_policy_version_unique" UNIQUE("version"),
	CONSTRAINT "privacy_policy_status" CHECK ("privacy_policy"."status" IN ('approved', 'retired')),
	CONSTRAINT "privacy_policy_min_days" CHECK ("privacy_policy"."min_days_after_block" BETWEEN 0 AND 3650),
	CONSTRAINT "privacy_policy_retired_consistent" CHECK (("privacy_policy"."status" = 'retired') = ("privacy_policy"."retired_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "privacy_erasure_run" ADD CONSTRAINT "privacy_erasure_run_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_erasure_run" ADD CONSTRAINT "privacy_erasure_run_policy_id_privacy_policy_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."privacy_policy"("policy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy" ADD CONSTRAINT "privacy_policy_approved_by_admin_user_admin_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_registry_order_unique" ON "privacy_erasure_registry" USING btree ("erase_order") WHERE "privacy_erasure_registry"."erase_order" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_erasure_run_completed_once" ON "privacy_erasure_run" USING btree ("project_id") WHERE "privacy_erasure_run"."outcome" = 'completed';--> statement-breakpoint
CREATE INDEX "privacy_erasure_run_project_idx" ON "privacy_erasure_run" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_policy_one_approved" ON "privacy_policy" USING btree ((true)) WHERE "privacy_policy"."status" = 'approved';