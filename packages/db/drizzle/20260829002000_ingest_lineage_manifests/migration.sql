CREATE TABLE "ingest"."normalization_attempt" (
	"normalization_attempt_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest"."normalization_attempt_normalization_attempt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"observation_id" bigint NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"schema_fingerprint" char(64),
	"quarantine_reason" text,
	CONSTRAINT "normalization_attempt_run_observation_parser_key" UNIQUE("run_id","observation_id","parser_version"),
	CONSTRAINT "normalization_attempt_status_allowed" CHECK ("status" in ('normalized', 'quarantined')),
	CONSTRAINT "normalization_attempt_final_metadata" CHECK ((
        "status" = 'normalized'
        and "schema_fingerprint" is not null
        and "quarantine_reason" is null
      ) or (
        "status" = 'quarantined'
        and "quarantine_reason" is not null
      )),
	CONSTRAINT "normalization_attempt_schema_fingerprint_sha256" CHECK ("schema_fingerprint" is null or "schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "normalization_attempt_quarantine_reason_bounded" CHECK ("quarantine_reason" is null or char_length("quarantine_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ingest"."normalization_attempt_record" (
	"normalization_attempt_id" bigint,
	"normalized_record_id" bigint,
	CONSTRAINT "normalization_attempt_record_pkey" PRIMARY KEY("normalization_attempt_id","normalized_record_id")
);
--> statement-breakpoint
CREATE TABLE "ingest"."publication_record" (
	"publication_id" uuid,
	"normalized_record_id" bigint,
	CONSTRAINT "publication_record_pkey" PRIMARY KEY("publication_id","normalized_record_id")
);
--> statement-breakpoint
CREATE TABLE "ingest"."replay_input" (
	"run_id" uuid,
	"observation_id" bigint,
	CONSTRAINT "replay_input_pkey" PRIMARY KEY("run_id","observation_id")
);
--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" DROP CONSTRAINT "raw_observation_parser_status_allowed";--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" DROP COLUMN "source_entity_id";--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" DROP COLUMN "schema_fingerprint";--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" DROP COLUMN "parser_status";--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" DROP COLUMN "quarantine_reason";--> statement-breakpoint
ALTER TABLE "ingest"."normalization_attempt" ADD CONSTRAINT "normalization_attempt_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");--> statement-breakpoint
ALTER TABLE "ingest"."normalization_attempt" ADD CONSTRAINT "normalization_attempt_2aB48gsQFeih_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "ingest"."normalization_attempt_record" ADD CONSTRAINT "normalization_attempt_record_C6jcxJRkuJbb_fkey" FOREIGN KEY ("normalization_attempt_id") REFERENCES "ingest"."normalization_attempt"("normalization_attempt_id");--> statement-breakpoint
ALTER TABLE "ingest"."normalization_attempt_record" ADD CONSTRAINT "normalization_attempt_record_4tMeOI1LZ5rR_fkey" FOREIGN KEY ("normalized_record_id") REFERENCES "ingest"."normalized_record"("normalized_record_id");--> statement-breakpoint
ALTER TABLE "ingest"."publication_record" ADD CONSTRAINT "publication_record_aroJ2ZYN2yAV_fkey" FOREIGN KEY ("publication_id") REFERENCES "ingest"."publication"("publication_id");--> statement-breakpoint
ALTER TABLE "ingest"."publication_record" ADD CONSTRAINT "publication_record_OkmovJzgKyKQ_fkey" FOREIGN KEY ("normalized_record_id") REFERENCES "ingest"."normalized_record"("normalized_record_id");--> statement-breakpoint
ALTER TABLE "ingest"."replay_input" ADD CONSTRAINT "replay_input_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");--> statement-breakpoint
ALTER TABLE "ingest"."replay_input" ADD CONSTRAINT "replay_input_observation_id_raw_observation_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");