CREATE TABLE "fa4_marketing_consent" (
	"consent_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"consented" boolean NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"language" text NOT NULL,
	"wording_ref" text NOT NULL,
	CONSTRAINT "fa4_marketing_consent_language" CHECK ("fa4_marketing_consent"."language" IN ('es','en'))
);
--> statement-breakpoint
ALTER TABLE "fa4_marketing_consent" ADD CONSTRAINT "fa4_marketing_consent_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fa4_marketing_consent_project_idx" ON "fa4_marketing_consent" USING btree ("project_id","decided_at");