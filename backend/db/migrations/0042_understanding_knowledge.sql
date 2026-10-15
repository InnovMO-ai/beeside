CREATE TABLE "country_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"version" text NOT NULL,
	"destination_kind" text NOT NULL,
	"destination_ref" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_at" text,
	"updated_at" text NOT NULL,
	"topic" text,
	"section" text,
	CONSTRAINT "country_resource_country" CHECK ("country_resource"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "country_resource_language" CHECK ("country_resource"."language" ~ '^[a-z]{2}$'),
	CONSTRAINT "country_resource_kind" CHECK ("country_resource"."destination_kind" IN ('url','document')),
	CONSTRAINT "country_resource_https" CHECK ("country_resource"."destination_kind" <> 'url' OR "country_resource"."destination_ref" ~ '^https://[^ ]+$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"status" text NOT NULL,
	"candidate" jsonb NOT NULL,
	"data" "bytea",
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "knowledge_candidate_status" CHECK ("knowledge_candidate"."status" IN ('pending_review','approved','rejected','auto_applied','unchanged'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_document" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"edition" text NOT NULL,
	"version" integer NOT NULL,
	"published_at" text,
	"effective_at" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"jurisdiction" text NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"locator" text NOT NULL,
	"content_hash" text NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_id" text,
	"superseded_by_id" text,
	"language" text DEFAULT 'es' NOT NULL,
	CONSTRAINT "knowledge_document_status" CHECK ("knowledge_document"."status" IN ('active','superseded','withdrawn')),
	CONSTRAINT "knowledge_document_confidence" CHECK ("knowledge_document"."confidence" IN ('high','medium','low')),
	CONSTRAINT "knowledge_document_hash" CHECK ("knowledge_document"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_document_superseded_consistent" CHECK (("knowledge_document"."status" = 'superseded') = ("knowledge_document"."superseded_by_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "knowledge_passage" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"source_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"location" text NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"units" text[] DEFAULT '{}'::text[] NOT NULL,
	"granularity" text NOT NULL,
	"indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "knowledge_passage_granularity" CHECK ("knowledge_passage"."granularity" IN ('country','state','municipality','city','sector','none')),
	CONSTRAINT "knowledge_passage_indicators" CHECK (jsonb_typeof("knowledge_passage"."indicators") = 'array')
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"id" text PRIMARY KEY NOT NULL,
	"institution" text NOT NULL,
	"domains" text[] NOT NULL,
	"jurisdiction" text NOT NULL,
	"topics" text[] NOT NULL,
	"authority" text NOT NULL,
	"roles" text[] NOT NULL,
	"is_primary" boolean NOT NULL,
	"cadence" text NOT NULL,
	"risk" text NOT NULL,
	"review_required" boolean NOT NULL,
	"granularity" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_source_id" CHECK ("knowledge_source"."id" ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
	CONSTRAINT "knowledge_source_authority" CHECK ("knowledge_source"."authority" IN ('official_primary','trusted_institutional','beeside_curated','secondary')),
	CONSTRAINT "knowledge_source_cadence" CHECK ("knowledge_source"."cadence" IN ('continuous','monthly','quarterly','annual','biennial','ad_hoc')),
	CONSTRAINT "knowledge_source_risk" CHECK ("knowledge_source"."risk" IN ('high','medium','low')),
	CONSTRAINT "knowledge_source_granularity" CHECK ("knowledge_source"."granularity" IN ('country','state','municipality','city','sector','none')),
	CONSTRAINT "knowledge_source_obligation_authority" CHECK (NOT ('obligation' = ANY("knowledge_source"."roles")) OR "knowledge_source"."authority" = 'official_primary'),
	CONSTRAINT "knowledge_source_high_risk_review" CHECK ("knowledge_source"."risk" <> 'high' OR "knowledge_source"."review_required"),
	CONSTRAINT "knowledge_source_domains" CHECK (cardinality("knowledge_source"."domains") >= 1)
);
--> statement-breakpoint
CREATE TABLE "understanding_frame" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"locale" text NOT NULL,
	"frame" jsonb NOT NULL,
	"discovery_pin_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "understanding_frame_locale" CHECK ("understanding_frame"."locale" IN ('en','es')),
	CONSTRAINT "understanding_frame_object" CHECK (jsonb_typeof("understanding_frame"."frame") = 'object'),
	CONSTRAINT "understanding_frame_version" CHECK ("understanding_frame"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "understanding_frame_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "understanding_frame_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"turn_key" text NOT NULL,
	"kind" text NOT NULL,
	"frame_version" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "understanding_frame_event_kind" CHECK ("understanding_frame_event"."kind" IN ('seed','turn','edit','correction','freshness','close')),
	CONSTRAINT "understanding_frame_event_payload" CHECK (jsonb_typeof("understanding_frame_event"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."knowledge_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."knowledge_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD CONSTRAINT "knowledge_passage_document_id_knowledge_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD CONSTRAINT "knowledge_passage_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_frame" ADD CONSTRAINT "understanding_frame_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_frame_event" ADD CONSTRAINT "understanding_frame_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "country_resource_country" ON "country_resource" USING btree ("country_code","active");--> statement-breakpoint
CREATE INDEX "knowledge_candidate_status" ON "knowledge_candidate" USING btree ("status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_version" ON "knowledge_document" USING btree ("source_id","title","version");--> statement-breakpoint
CREATE INDEX "knowledge_document_source_status" ON "knowledge_document" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_passage_document" ON "knowledge_passage" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "understanding_frame_event_key" ON "understanding_frame_event" USING btree ("project_id","turn_key","kind");--> statement-breakpoint
CREATE INDEX "understanding_frame_event_project_seq" ON "understanding_frame_event" USING btree ("project_id","seq");