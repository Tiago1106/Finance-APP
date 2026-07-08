CREATE TABLE "bot_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_pending_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_link_code_idx" ON "users" USING btree ("telegram_link_code");