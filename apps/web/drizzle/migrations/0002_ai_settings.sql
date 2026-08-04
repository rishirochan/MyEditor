CREATE TABLE "user_ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"build_provider" varchar(32) DEFAULT 'openai' NOT NULL,
	"build_model" varchar(255) DEFAULT 'gpt-4o-mini' NOT NULL,
	"build_endpoint" text,
	"build_api_key" text,
	"writer_provider" varchar(32) DEFAULT 'openai' NOT NULL,
	"writer_model" varchar(255) DEFAULT 'gpt-4o-mini' NOT NULL,
	"writer_endpoint" text,
	"writer_api_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_ai_settings_user_idx" ON "user_ai_settings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "user_ai_settings_provider_idx" ON "user_ai_settings" USING btree ("build_provider","writer_provider");
