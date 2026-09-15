CREATE TABLE "premium_activation_request" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"terms_url" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"interface_language" text NOT NULL,
	"checkout_adapter" text NOT NULL,
	"checkout_reference" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by_event_id" uuid
);
--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD COLUMN "contract_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD COLUMN "source_snapshot_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD COLUMN "source_internal_assessment_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD COLUMN "generated_by_event_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "premium_activation_request" ADD CONSTRAINT "premium_activation_request_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_activation_request" ADD CONSTRAINT "premium_activation_request_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_activation_request" ADD CONSTRAINT "premium_activation_request_fulfilled_by_event_id_subscription_event_event_id_fk" FOREIGN KEY ("fulfilled_by_event_id") REFERENCES "public"."subscription_event"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "premium_activation_request_project_idx" ON "premium_activation_request" USING btree ("project_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_activation_request_one_open" ON "premium_activation_request" USING btree ("project_id") WHERE "premium_activation_request"."status" = 'REQUESTED';--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD CONSTRAINT "precision_handoff_package_source_snapshot_id_snapshot_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."snapshot"("snapshot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD CONSTRAINT "precision_handoff_package_source_internal_assessment_id_internal_assessment_internal_assessment_id_fk" FOREIGN KEY ("source_internal_assessment_id") REFERENCES "public"."internal_assessment"("internal_assessment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD CONSTRAINT "precision_handoff_package_generated_by_event_id_subscription_event_event_id_fk" FOREIGN KEY ("generated_by_event_id") REFERENCES "public"."subscription_event"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_one_open_per_project" ON "subscription" USING btree ("project_id") WHERE "subscription"."status" <> 'PREMIUM_INACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_event_idempotency_key_unique" ON "subscription_event" USING btree ("idempotency_key");