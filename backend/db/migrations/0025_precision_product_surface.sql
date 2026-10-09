CREATE TABLE "crp_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "precision_access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precision_access_token_kind" CHECK ("precision_access_token"."kind" IN ('link','session')),
	CONSTRAINT "precision_access_token_hash_format" CHECK ("precision_access_token"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "precision_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT '*' NOT NULL,
	"value" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precision_config_key" CHECK ("precision_config"."key" ~ '^[a-z][a-z0-9_.]{1,80}$'),
	CONSTRAINT "precision_config_locale" CHECK ("precision_config"."locale" IN ('*','en','es'))
);
--> statement-breakpoint
CREATE TABLE "precision_cover_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"asset_ref" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"focal_x" real DEFAULT 0.5 NOT NULL,
	"focal_y" real DEFAULT 0.5 NOT NULL,
	"alt_text" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precision_cover_asset_country" CHECK ("precision_cover_asset"."country_code" ~ '^([A-Z]{2}|\*)$'),
	CONSTRAINT "precision_cover_asset_focal" CHECK ("precision_cover_asset"."focal_x" BETWEEN 0 AND 1 AND "precision_cover_asset"."focal_y" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "precision_cover_seen" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "precision_journey_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"event_key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"interface_language" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precision_journey_event_name" CHECK ("precision_journey_event"."event_name" ~ '^[a-z][a-z0-9_]{2,60}$'),
	CONSTRAINT "precision_journey_event_props_object" CHECK (jsonb_typeof("precision_journey_event"."properties") = 'object')
);
--> statement-breakpoint
CREATE TABLE "precision_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "precision_turn_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"scope_instance_id" uuid NOT NULL,
	"turn_key" text NOT NULL,
	"role" text NOT NULL,
	"surface" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"locale" text NOT NULL,
	"content" text NOT NULL,
	"structured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precision_turn_role" CHECK ("precision_turn"."role" IN ('client','assistant')),
	CONSTRAINT "precision_turn_surface" CHECK ("precision_turn"."surface" IN ('understanding','category','add_service')),
	CONSTRAINT "precision_turn_kind" CHECK ("precision_turn"."kind" IN ('message','process_question','disclosure','notice')),
	CONSTRAINT "precision_turn_locale" CHECK ("precision_turn"."locale" IN ('en','es')),
	CONSTRAINT "precision_turn_content_len" CHECK (char_length("precision_turn"."content") BETWEEN 1 AND 8000),
	CONSTRAINT "precision_turn_key_format" CHECK ("precision_turn"."turn_key" ~ '^[A-Za-z0-9_.:-]{8,120}$')
);
--> statement-breakpoint
ALTER TABLE "crp_confirmation" ADD CONSTRAINT "crp_confirmation_pack_id_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crp_confirmation" ADD CONSTRAINT "crp_confirmation_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_access_token" ADD CONSTRAINT "precision_access_token_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_cover_seen" ADD CONSTRAINT "precision_cover_seen_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_journey_event" ADD CONSTRAINT "precision_journey_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_turn" ADD CONSTRAINT "precision_turn_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_turn" ADD CONSTRAINT "precision_turn_scope_instance_id_precision_instance_id_fk" FOREIGN KEY ("scope_instance_id") REFERENCES "public"."precision_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crp_confirmation_pack_unique" ON "crp_confirmation" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "crp_confirmation_project_idx" ON "crp_confirmation" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_access_token_hash_unique" ON "precision_access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "precision_access_token_project_idx" ON "precision_access_token" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_config_active_unique" ON "precision_config" USING btree ("key","locale") WHERE "precision_config"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "precision_cover_asset_country_unique" ON "precision_cover_asset" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_journey_event_key_unique" ON "precision_journey_event" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "precision_journey_event_project_idx" ON "precision_journey_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_turn_key_role_unique" ON "precision_turn" USING btree ("project_id","turn_key","role");--> statement-breakpoint
CREATE INDEX "precision_turn_scope_idx" ON "precision_turn" USING btree ("scope_instance_id","seq");