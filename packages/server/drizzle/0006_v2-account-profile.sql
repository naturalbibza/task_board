ALTER TABLE "users" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "messengers" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokenVersion" integer DEFAULT 0 NOT NULL;