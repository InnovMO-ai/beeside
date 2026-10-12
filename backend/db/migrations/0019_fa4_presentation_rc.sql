CREATE TABLE "fa4_contact_request" (
	"contact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"share_progress" boolean DEFAULT false NOT NULL,
	"language" text NOT NULL,
	"client_request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa4_contact_request_language" CHECK ("fa4_contact_request"."language" IN ('es','en'))
);
--> statement-breakpoint
CREATE TABLE "fa4_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"visit_id" uuid,
	"project_id" uuid,
	"locale" text,
	"step" text,
	"catalog_version" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "fa4_event_source" CHECK ("fa4_event"."source" IN ('client','server'))
);
--> statement-breakpoint
ALTER TABLE "fa4_email_delivery" DROP CONSTRAINT "fa4_email_delivery_template";--> statement-breakpoint
ALTER TABLE "fa4_email_delivery" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fa4_email_delivery" ADD COLUMN "contact_request_id" uuid;--> statement-breakpoint
ALTER TABLE "fa4_contact_request" ADD CONSTRAINT "fa4_contact_request_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_event" ADD CONSTRAINT "fa4_event_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fa4_contact_request_project_idx" ON "fa4_contact_request" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_contact_request_idem_unique" ON "fa4_contact_request" USING btree ("client_request_id");--> statement-breakpoint
CREATE INDEX "fa4_event_name_time_idx" ON "fa4_event" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "fa4_event_project_idx" ON "fa4_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fa4_event_visit_idx" ON "fa4_event" USING btree ("visit_id","occurred_at");--> statement-breakpoint
ALTER TABLE "fa4_email_delivery" ADD CONSTRAINT "fa4_email_delivery_template" CHECK ("fa4_email_delivery"."template" IN ('fa4_resume_link','fa4_result_link','fa4_contact_request'));