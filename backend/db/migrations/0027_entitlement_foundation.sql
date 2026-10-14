CREATE TABLE "entitlement_grant" (
	"grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"company_id" uuid,
	"source" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"market_scope" text[],
	"campaign_id" uuid,
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
	CONSTRAINT "entitlement_grant_source" CHECK ("entitlement_grant"."source" IN ('complimentary', 'promotion', 'trial', 'manual', 'partner')),
	CONSTRAINT "entitlement_grant_window" CHECK ("entitlement_grant"."ends_at" > "entitlement_grant"."starts_at"),
	CONSTRAINT "entitlement_grant_reason" CHECK (length(btrim("entitlement_grant"."reason")) > 0),
	CONSTRAINT "entitlement_grant_campaign_source" CHECK (("entitlement_grant"."source" IN ('promotion', 'trial', 'partner')) OR "entitlement_grant"."campaign_id" IS NULL),
	CONSTRAINT "entitlement_grant_promotion_has_campaign" CHECK ("entitlement_grant"."source" <> 'promotion' OR "entitlement_grant"."campaign_id" IS NOT NULL),
	CONSTRAINT "entitlement_grant_market_nonempty" CHECK ("entitlement_grant"."market_scope" IS NULL OR cardinality("entitlement_grant"."market_scope") > 0),
	CONSTRAINT "entitlement_grant_termination_coherent" CHECK (("entitlement_grant"."terminated_at" IS NULL) = ("entitlement_grant"."termination_reason" IS NULL) AND ("entitlement_grant"."terminated_at" IS NULL) = ("entitlement_grant"."terminated_by" IS NULL)),
	CONSTRAINT "entitlement_grant_terminated_after_start" CHECK ("entitlement_grant"."terminated_at" IS NULL OR "entitlement_grant"."terminated_at" >= "entitlement_grant"."starts_at"),
	CONSTRAINT "entitlement_grant_not_self_extension" CHECK ("entitlement_grant"."extends_grant_id" IS NULL OR "entitlement_grant"."extends_grant_id" <> "entitlement_grant"."grant_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_campaign" (
	"campaign_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"market_scope" text[],
	"grant_days" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_redemptions" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "promotion_campaign_code_format" CHECK ("promotion_campaign"."code" ~ '^[a-z0-9][a-z0-9_-]{2,40}$'),
	CONSTRAINT "promotion_campaign_kind" CHECK ("promotion_campaign"."kind" IN ('promotion', 'trial', 'partner')),
	CONSTRAINT "promotion_campaign_status" CHECK ("promotion_campaign"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "promotion_campaign_grant_days" CHECK ("promotion_campaign"."grant_days" BETWEEN 1 AND 3650),
	CONSTRAINT "promotion_campaign_window" CHECK ("promotion_campaign"."ends_at" > "promotion_campaign"."starts_at"),
	CONSTRAINT "promotion_campaign_quota" CHECK ("promotion_campaign"."max_redemptions" IS NULL OR "promotion_campaign"."max_redemptions" > 0),
	CONSTRAINT "promotion_campaign_market_nonempty" CHECK ("promotion_campaign"."market_scope" IS NULL OR cardinality("promotion_campaign"."market_scope") > 0),
	CONSTRAINT "promotion_campaign_reason" CHECK (length(btrim("promotion_campaign"."reason")) > 0),
	CONSTRAINT "promotion_campaign_active_is_approved" CHECK ("promotion_campaign"."status" = 'draft' OR "promotion_campaign"."approved_by" IS NOT NULL),
	CONSTRAINT "promotion_campaign_closed_coherent" CHECK (("promotion_campaign"."status" = 'closed') = ("promotion_campaign"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_campaign_id_promotion_campaign_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."promotion_campaign"("campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_approved_by_admin_user_admin_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_extends_grant_id_entitlement_grant_grant_id_fk" FOREIGN KEY ("extends_grant_id") REFERENCES "public"."entitlement_grant"("grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_terminated_by_admin_user_admin_user_id_fk" FOREIGN KEY ("terminated_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_campaign" ADD CONSTRAINT "promotion_campaign_created_by_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_campaign" ADD CONSTRAINT "promotion_campaign_approved_by_admin_user_admin_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_grant_project_idx" ON "entitlement_grant" USING btree ("project_id","starts_at");--> statement-breakpoint
CREATE INDEX "entitlement_grant_company_idx" ON "entitlement_grant" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE INDEX "entitlement_grant_campaign_idx" ON "entitlement_grant" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_idempotency_unique" ON "entitlement_grant" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_campaign_project_unique" ON "entitlement_grant" USING btree ("campaign_id","project_id") WHERE "entitlement_grant"."campaign_id" IS NOT NULL AND "entitlement_grant"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_campaign_company_unique" ON "entitlement_grant" USING btree ("campaign_id","company_id") WHERE "entitlement_grant"."campaign_id" IS NOT NULL AND "entitlement_grant"."company_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_campaign_code_unique" ON "promotion_campaign" USING btree ("code");