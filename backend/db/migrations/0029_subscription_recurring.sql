ALTER TYPE "public"."subscription_event_type" ADD VALUE 'subscription_renewed';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE 'cancellation_withdrawn';--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "auto_renews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "premium_checkout" ADD COLUMN "billing_mode" text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "premium_checkout" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
CREATE INDEX "premium_checkout_subscription_idx" ON "premium_checkout" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "premium_checkout" ADD CONSTRAINT "premium_checkout_billing_mode" CHECK ("premium_checkout"."billing_mode" IN ('payment', 'subscription'));