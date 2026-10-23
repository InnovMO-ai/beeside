CREATE TABLE "billing_alert" (
	"alert_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"stripe_ref" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "billing_alert_kind_format" CHECK ("billing_alert"."kind" ~ '^[a-z][a-z0-9_]{2,60}$')
);
--> statement-breakpoint
CREATE TABLE "billing_inbound_event" (
	"inbound_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"stripe_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"project_id" uuid,
	"stripe_session_id" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_inbound_event_processed_coherent" CHECK (("billing_inbound_event"."processed_at" IS NULL) = ("billing_inbound_event"."outcome" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "premium_checkout" (
	"checkout_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid,
	"stripe_session_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"idempotency_key" text NOT NULL,
	"checkout_url" text,
	"interface_language" text NOT NULL,
	"amount_total" bigint,
	"currency" text,
	"paid_amount_total" bigint,
	"stripe_payment_intent_id" text,
	"outcome" text,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "premium_checkout_status" CHECK ("premium_checkout"."status" IN ('open', 'completed', 'expired', 'failed')),
	CONSTRAINT "premium_checkout_language" CHECK ("premium_checkout"."interface_language" IN ('es', 'en')),
	CONSTRAINT "premium_checkout_currency" CHECK ("premium_checkout"."currency" IS NULL OR "premium_checkout"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "premium_checkout_amounts" CHECK (("premium_checkout"."amount_total" IS NULL OR "premium_checkout"."amount_total" >= 0) AND ("premium_checkout"."paid_amount_total" IS NULL OR "premium_checkout"."paid_amount_total" >= 0)),
	CONSTRAINT "premium_checkout_completed_coherent" CHECK (("premium_checkout"."status" = 'completed') = ("premium_checkout"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "entitlement" ADD COLUMN "precision_access_mode" text DEFAULT 'FULL' NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlement" ADD COLUMN "premium_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlement" ADD COLUMN "readonly_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlement" ADD COLUMN "grace_days_applied" integer;--> statement-breakpoint
ALTER TABLE "entitlement" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_alert" ADD CONSTRAINT "billing_alert_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_inbound_event" ADD CONSTRAINT "billing_inbound_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_checkout" ADD CONSTRAINT "premium_checkout_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_checkout" ADD CONSTRAINT "premium_checkout_request_id_premium_activation_request_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."premium_activation_request"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_alert_open_idx" ON "billing_alert" USING btree ("created_at") WHERE "billing_alert"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "billing_alert_project_idx" ON "billing_alert" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_alert_kind_ref_unique" ON "billing_alert" USING btree ("kind","stripe_ref") WHERE "billing_alert"."stripe_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_inbound_event_stripe_event_unique" ON "billing_inbound_event" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "billing_inbound_event_received_idx" ON "billing_inbound_event" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "billing_inbound_event_project_idx" ON "billing_inbound_event" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_checkout_session_unique" ON "premium_checkout" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_checkout_idempotency_key_unique" ON "premium_checkout" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_checkout_one_open_per_project" ON "premium_checkout" USING btree ("project_id") WHERE "premium_checkout"."status" = 'open';--> statement-breakpoint
CREATE INDEX "premium_checkout_project_idx" ON "premium_checkout" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "premium_checkout_payment_intent_idx" ON "premium_checkout" USING btree ("stripe_payment_intent_id");