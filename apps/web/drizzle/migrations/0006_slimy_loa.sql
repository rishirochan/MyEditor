ALTER TABLE "builds" ADD COLUMN "main_file" varchar(1000);--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "is_document" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "builds"
SET "main_file" = "projects"."main_file"
FROM "projects"
WHERE "builds"."project_id" = "projects"."id";--> statement-breakpoint
ALTER TABLE "builds" ALTER COLUMN "main_file" SET NOT NULL;--> statement-breakpoint
UPDATE "project_files"
SET "is_document" = true
FROM "projects"
WHERE "project_files"."project_id" = "projects"."id"
  AND "project_files"."path" = "projects"."main_file";--> statement-breakpoint
CREATE INDEX "builds_project_main_file_idx" ON "builds" USING btree ("project_id","main_file");
