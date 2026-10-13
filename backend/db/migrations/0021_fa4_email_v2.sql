ALTER TABLE "fa4_access_token" DROP CONSTRAINT "fa4_access_token_kind";--> statement-breakpoint
ALTER TABLE "fa4_contact_request" ADD COLUMN "origin_stage" text DEFAULT 'FA' NOT NULL;--> statement-breakpoint
ALTER TABLE "fa4_access_token" ADD CONSTRAINT "fa4_access_token_kind" CHECK ("fa4_access_token"."kind" IN ('SESSION','RESUME','YEV_LINK'));--> statement-breakpoint
ALTER TABLE "fa4_contact_request" ADD CONSTRAINT "fa4_contact_request_stage" CHECK ("fa4_contact_request"."origin_stage" IN ('FA','YEV'));