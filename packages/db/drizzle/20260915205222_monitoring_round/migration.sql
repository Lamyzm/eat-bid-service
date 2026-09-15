CREATE SCHEMA "monitoring";
--> statement-breakpoint
CREATE TABLE "monitoring"."round" (
	"observed_at" timestamp with time zone,
	"environment" varchar(16),
	"runs_started_1h" jsonb NOT NULL,
	"runs_failed_1h" jsonb NOT NULL,
	"auctions_published_1h" integer NOT NULL,
	"open_auctions_now" integer NOT NULL,
	"backfill_windows_incomplete" integer NOT NULL,
	"violations_open" integer NOT NULL,
	"check_duration_ms" integer NOT NULL,
	CONSTRAINT "monitoring_round_pkey" PRIMARY KEY("environment","observed_at"),
	CONSTRAINT "monitoring_round_counts_nonnegative" CHECK ("auctions_published_1h" >= 0
        and "open_auctions_now" >= 0
        and "backfill_windows_incomplete" >= 0
        and "violations_open" >= 0
        and "check_duration_ms" >= 0),
	CONSTRAINT "monitoring_round_counts_are_objects" CHECK (jsonb_typeof("runs_started_1h") = 'object' and jsonb_typeof("runs_failed_1h") = 'object')
);
