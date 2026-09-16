CREATE TABLE "ingest"."source_hold" (
	"hold_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest"."source_hold_hold_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" varchar(32) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"detail" text NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"held_by_run_id" uuid,
	"release_after" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "ingest_source_hold_reason" CHECK ("reason" in ('source-throttled')),
	CONSTRAINT "ingest_source_hold_release_after_held" CHECK ("release_after" > "held_at")
);
--> statement-breakpoint
CREATE INDEX "ingest_source_hold_source_release_idx" ON "ingest"."source_hold" ("source","release_after");