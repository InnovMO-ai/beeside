ALTER TYPE "public"."admin_role" ADD VALUE 'SUPER_ADMIN';--> statement-breakpoint
CREATE TABLE "entitlement_grant" (
	"grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"company_id" uuid,
	"company_scope" text,
	"max_projects" integer,
	"source" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"market_scope" text[],
	"program_id" uuid,
	"reason" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_by_actor" text NOT NULL,
	"extends_grant_id" uuid,
	"idempotency_key" text,
	"terminated_at" timestamp with time zone,
	"terminated_by" uuid,
	"termination_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grant_scope" CHECK (("entitlement_grant"."project_id" IS NULL) <> ("entitlement_grant"."company_id" IS NULL)),
	CONSTRAINT "entitlement_grant_company_scope" CHECK (("entitlement_grant"."company_id" IS NULL) = ("entitlement_grant"."company_scope" IS NULL)),
	CONSTRAINT "entitlement_grant_company_scope_values" CHECK ("entitlement_grant"."company_scope" IS NULL OR "entitlement_grant"."company_scope" IN ('current_projects', 'projects_created_in_period')),
	CONSTRAINT "entitlement_grant_max_projects" CHECK ("entitlement_grant"."max_projects" IS NULL OR ("entitlement_grant"."company_id" IS NOT NULL AND "entitlement_grant"."max_projects" > 0)),
	CONSTRAINT "entitlement_grant_source" CHECK ("entitlement_grant"."source" IN ('complimentary', 'promotion', 'trial', 'manual', 'partner', 'sponsored')),
	CONSTRAINT "entitlement_grant_window" CHECK ("entitlement_grant"."ends_at" > "entitlement_grant"."starts_at"),
	CONSTRAINT "entitlement_grant_reason" CHECK (length(btrim("entitlement_grant"."reason")) > 0),
	CONSTRAINT "entitlement_grant_program_source" CHECK (("entitlement_grant"."source" IN ('promotion', 'trial', 'partner', 'sponsored')) OR "entitlement_grant"."program_id" IS NULL),
	CONSTRAINT "entitlement_grant_program_required" CHECK ("entitlement_grant"."source" NOT IN ('promotion', 'sponsored') OR "entitlement_grant"."program_id" IS NOT NULL),
	CONSTRAINT "entitlement_grant_market_nonempty" CHECK ("entitlement_grant"."market_scope" IS NULL OR cardinality("entitlement_grant"."market_scope") > 0),
	CONSTRAINT "entitlement_grant_termination_coherent" CHECK (("entitlement_grant"."terminated_at" IS NULL) = ("entitlement_grant"."termination_reason" IS NULL) AND ("entitlement_grant"."terminated_at" IS NULL) = ("entitlement_grant"."terminated_by" IS NULL)),
	CONSTRAINT "entitlement_grant_terminated_after_start" CHECK ("entitlement_grant"."terminated_at" IS NULL OR "entitlement_grant"."terminated_at" >= "entitlement_grant"."starts_at"),
	CONSTRAINT "entitlement_grant_not_self_extension" CHECK ("entitlement_grant"."extends_grant_id" IS NULL OR "entitlement_grant"."extends_grant_id" <> "entitlement_grant"."grant_id")
);
--> statement-breakpoint
CREATE TABLE "entitlement_program" (
	"program_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sponsor_id" uuid,
	"agreement_ref" text,
	"market_scope" text[],
	"grant_days" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_redemptions" integer,
	"eligibility" text DEFAULT 'open' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "entitlement_program_code_format" CHECK ("entitlement_program"."code" ~ '^[a-z0-9][a-z0-9_-]{2,40}$'),
	CONSTRAINT "entitlement_program_kind" CHECK ("entitlement_program"."kind" IN ('promotion', 'trial', 'partner', 'sponsored')),
	CONSTRAINT "entitlement_program_status" CHECK ("entitlement_program"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "entitlement_program_eligibility" CHECK ("entitlement_program"."eligibility" IN ('open', 'listed')),
	CONSTRAINT "entitlement_program_sponsor" CHECK (("entitlement_program"."kind" = 'sponsored') = ("entitlement_program"."sponsor_id" IS NOT NULL)),
	CONSTRAINT "entitlement_program_grant_days" CHECK ("entitlement_program"."grant_days" BETWEEN 1 AND 3650),
	CONSTRAINT "entitlement_program_window" CHECK ("entitlement_program"."ends_at" > "entitlement_program"."starts_at"),
	CONSTRAINT "entitlement_program_quota" CHECK ("entitlement_program"."max_redemptions" IS NULL OR "entitlement_program"."max_redemptions" > 0),
	CONSTRAINT "entitlement_program_market_nonempty" CHECK ("entitlement_program"."market_scope" IS NULL OR cardinality("entitlement_program"."market_scope") > 0),
	CONSTRAINT "entitlement_program_reason" CHECK (length(btrim("entitlement_program"."reason")) > 0),
	CONSTRAINT "entitlement_program_active_is_approved" CHECK ("entitlement_program"."status" = 'draft' OR "entitlement_program"."approved_by" IS NOT NULL),
	CONSTRAINT "entitlement_program_closed_coherent" CHECK (("entitlement_program"."status" = 'closed') = ("entitlement_program"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "entitlement_program_eligibility" (
	"program_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_program_eligibility_program_id_company_id_pk" PRIMARY KEY("program_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "project_privacy_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "project_privacy_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"event" text NOT NULL,
	"reason_code" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_privacy_event_name" CHECK ("project_privacy_event"."event" IN ('access_blocked', 'access_restored', 'anonymized')),
	CONSTRAINT "project_privacy_event_reason" CHECK ("project_privacy_event"."reason_code" IN ('erasure_request', 'legal_order', 'contract_closure', 'security_action', 'other')),
	CONSTRAINT "project_privacy_event_actor" CHECK (length(btrim("project_privacy_event"."actor")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sponsor" (
	"sponsor_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"country" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_kind" CHECK ("sponsor"."kind" IN ('government', 'agency', 'chamber', 'accelerator', 'corporate', 'other')),
	CONSTRAINT "sponsor_status" CHECK ("sponsor"."status" IN ('active', 'inactive')),
	CONSTRAINT "sponsor_country" CHECK ("sponsor"."country" IS NULL OR "sponsor"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "sponsor_name" CHECK (length(btrim("sponsor"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_program_id_entitlement_program_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."entitlement_program"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_approved_by_admin_user_admin_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_extends_grant_id_entitlement_grant_grant_id_fk" FOREIGN KEY ("extends_grant_id") REFERENCES "public"."entitlement_grant"("grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_terminated_by_admin_user_admin_user_id_fk" FOREIGN KEY ("terminated_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program" ADD CONSTRAINT "entitlement_program_sponsor_id_sponsor_sponsor_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor"("sponsor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program" ADD CONSTRAINT "entitlement_program_created_by_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program" ADD CONSTRAINT "entitlement_program_approved_by_admin_user_admin_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program_eligibility" ADD CONSTRAINT "entitlement_program_eligibility_program_id_entitlement_program_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."entitlement_program"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program_eligibility" ADD CONSTRAINT "entitlement_program_eligibility_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_program_eligibility" ADD CONSTRAINT "entitlement_program_eligibility_created_by_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_privacy_event" ADD CONSTRAINT "project_privacy_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_created_by_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_grant_project_idx" ON "entitlement_grant" USING btree ("project_id","starts_at");--> statement-breakpoint
CREATE INDEX "entitlement_grant_company_idx" ON "entitlement_grant" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE INDEX "entitlement_grant_program_idx" ON "entitlement_grant" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_idempotency_unique" ON "entitlement_grant" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_program_project_unique" ON "entitlement_grant" USING btree ("program_id","project_id") WHERE "entitlement_grant"."program_id" IS NOT NULL AND "entitlement_grant"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_program_company_unique" ON "entitlement_grant" USING btree ("program_id","company_id") WHERE "entitlement_grant"."program_id" IS NOT NULL AND "entitlement_grant"."company_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_program_code_unique" ON "entitlement_program" USING btree ("code");--> statement-breakpoint
CREATE INDEX "project_privacy_event_project_idx" ON "project_privacy_event" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_name_unique" ON "sponsor" USING btree (lower("name"));