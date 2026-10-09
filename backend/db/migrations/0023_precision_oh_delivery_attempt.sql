DROP INDEX "oh_delivery_idem_status_unique";--> statement-breakpoint
ALTER TABLE "oh_delivery" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "oh_delivery_idem_status_attempt_unique" ON "oh_delivery" USING btree ("idempotency_key","status","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "oh_delivery_one_delivered" ON "oh_delivery" USING btree ("idempotency_key") WHERE "oh_delivery"."status" = 'delivered';--> statement-breakpoint
CREATE INDEX "oh_delivery_project_status_idx" ON "oh_delivery" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "oh_delivery" ADD CONSTRAINT "oh_delivery_attempt_positive" CHECK ("oh_delivery"."attempt" >= 1);--> statement-breakpoint
ALTER TABLE "oh_delivery" ADD CONSTRAINT "oh_delivery_reference_only_delivered" CHECK (("oh_delivery"."status" = 'delivered') = ("oh_delivery"."oh_reference" IS NOT NULL));