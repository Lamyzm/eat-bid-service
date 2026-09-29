ALTER TABLE "mart"."build" ADD COLUMN "fill_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mart"."build" ADD COLUMN "fill_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mart"."build" ADD CONSTRAINT "mart_build_fill_chronology" CHECK ("fill_finished_at" is null
        or ("fill_started_at" is not null and "fill_finished_at" >= "fill_started_at"));