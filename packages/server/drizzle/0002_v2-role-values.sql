ALTER TYPE "public"."role" ADD VALUE 'ADMIN';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'EDITOR';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'VIEWER';--> statement-breakpoint
ALTER TABLE "board_members" ALTER COLUMN "role" DROP DEFAULT;