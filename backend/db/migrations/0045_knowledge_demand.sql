CREATE TABLE "knowledge_demand" (
	"id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"topic" text NOT NULL,
	"subtopic" text NOT NULL,
	"category_key" text,
	"service_key" text,
	"info_type" text NOT NULL,
	"coverage" text NOT NULL,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"boundary" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_demand_country" CHECK ("knowledge_demand"."country" ~ '^([A-Z]{2}|INT|unknown)$'),
	CONSTRAINT "knowledge_demand_slugs" CHECK ("knowledge_demand"."subtopic" ~ '^[a-z][a-z0-9_]{1,63}$' AND "knowledge_demand"."topic" ~ '^[a-z][a-z0-9_]{1,63}$' AND ("knowledge_demand"."category_key" IS NULL OR "knowledge_demand"."category_key" ~ '^[a-z][a-z0-9_]{1,63}$') AND ("knowledge_demand"."service_key" IS NULL OR "knowledge_demand"."service_key" ~ '^[A-Za-z][A-Za-z0-9_]{1,63}$')),
	CONSTRAINT "knowledge_demand_info_type" CHECK ("knowledge_demand"."info_type" IN ('regulatory_requirement','tax_treatment','procedure_steps','cost_estimate','timeline','statistics_comparison','local_provider_or_site','market_data','general_context')),
	CONSTRAINT "knowledge_demand_coverage" CHECK ("knowledge_demand"."coverage" IN ('absent','partial')),
	CONSTRAINT "knowledge_demand_disposition" CHECK ("knowledge_demand"."disposition" IN ('candidate_knowledge','specialist_service')),
	CONSTRAINT "knowledge_demand_reason" CHECK ("knowledge_demand"."reason" IN ('no_sources','no_hits','granularity','professional_judgment','unclassified')),
	CONSTRAINT "knowledge_demand_boundary" CHECK ("knowledge_demand"."boundary" IS NULL OR "knowledge_demand"."boundary" IN ('best_option','tax_conclusion','legal_opinion','labor_advice','logistics_optimization','market_entry_comparison','investment_recommendation')),
	CONSTRAINT "knowledge_demand_status" CHECK ("knowledge_demand"."status" IN ('open','triaged','accepted_for_curation','kept_as_service','declined')),
	CONSTRAINT "knowledge_demand_note" CHECK ("knowledge_demand"."decision_note" IS NULL OR char_length("knowledge_demand"."decision_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "knowledge_demand_event" (
	"demand_id" text NOT NULL,
	"project_ref" text NOT NULL,
	"turn_ref" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_demand_event_refs" CHECK ("knowledge_demand_event"."project_ref" ~ '^[0-9a-f]{32}$' AND "knowledge_demand_event"."turn_ref" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "knowledge_demand_event" ADD CONSTRAINT "knowledge_demand_event_demand_id_knowledge_demand_id_fk" FOREIGN KEY ("demand_id") REFERENCES "public"."knowledge_demand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_demand_rank" ON "knowledge_demand" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_demand_event_key" ON "knowledge_demand_event" USING btree ("demand_id","project_ref","turn_ref");--> statement-breakpoint
-- Privacy erasure registry: global tables. They hold no project data: the event table stores only one-way hashes (project_ref / turn_ref), never the project id, and no client text.
ALTER TABLE privacy_erasure_registry DISABLE TRIGGER privacy_registry_guard_trigger;--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason) VALUES
  ('knowledge_demand', 'global', 'global', NULL, NULL, 'normalised unmet-knowledge demand from controlled vocabularies; no client text, not project data'),
  ('knowledge_demand_event', 'global', 'global', NULL, NULL, 'recurrence counters keyed by one-way hashes; no project identifier, not project data');--> statement-breakpoint
ALTER TABLE privacy_erasure_registry ENABLE TRIGGER privacy_registry_guard_trigger;
