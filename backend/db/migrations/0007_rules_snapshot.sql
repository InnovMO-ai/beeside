ALTER TABLE "finding" ALTER COLUMN "reason_client" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capability_rank" ADD COLUMN "source_area_ids" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "capability_rank" ADD COLUMN "ranking_factors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "rule_triggered" text NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "reason_internal" text NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "source_type" text DEFAULT 'DERIVED_BY_RULE' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "panel_rank" smallint;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "included_in_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_alignment" ADD COLUMN "tests_matched" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_alignment" ADD COLUMN "rule_triggered" text;