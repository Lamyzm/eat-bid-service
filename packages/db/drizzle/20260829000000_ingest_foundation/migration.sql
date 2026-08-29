CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE SCHEMA "mart";
--> statement-breakpoint
CREATE TABLE "ingest"."run" (
	"run_id" uuid PRIMARY KEY,
	"mode" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"build_sha" char(64) NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"failure_category" varchar(64),
	"expected_count" bigint NOT NULL,
	"captured_count" bigint NOT NULL,
	"published_count" bigint NOT NULL,
	CONSTRAINT "run_status_allowed" CHECK ("status" in ('planned', 'running', 'failed', 'validated', 'published')),
	CONSTRAINT "run_expected_count_nonnegative" CHECK ("expected_count" >= 0),
	CONSTRAINT "run_captured_count_nonnegative" CHECK ("captured_count" >= 0),
	CONSTRAINT "run_published_count_nonnegative" CHECK ("published_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."normalized_record" (
	"normalized_record_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest"."normalized_record_normalized_record_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"observation_id" bigint NOT NULL,
	"record_type" varchar(64) NOT NULL,
	"source_entity_id" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"normalized_at" timestamp with time zone NOT NULL,
	CONSTRAINT "normalized_record_observation_type_entity_parser_key" UNIQUE("observation_id","record_type","source_entity_id","parser_version")
);
--> statement-breakpoint
CREATE TABLE "ingest"."publication" (
	"publication_id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL CONSTRAINT "publication_run_id_key" UNIQUE,
	"status" varchar(16) NOT NULL,
	"validated_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"expected_count" bigint NOT NULL,
	"normalized_count" bigint NOT NULL,
	"published_count" bigint NOT NULL,
	CONSTRAINT "publication_status_allowed" CHECK ("status" in ('pending', 'validated', 'published', 'failed')),
	CONSTRAINT "publication_expected_count_nonnegative" CHECK ("expected_count" >= 0),
	CONSTRAINT "publication_normalized_count_nonnegative" CHECK ("normalized_count" >= 0),
	CONSTRAINT "publication_published_count_nonnegative" CHECK ("published_count" >= 0),
	CONSTRAINT "publication_validated_requires_validation_timestamp" CHECK ("status" not in ('validated', 'published') or "validated_at" is not null),
	CONSTRAINT "publication_published_requires_gate" CHECK ("status" <> 'published' or (
        "validated_at" is not null
        and "activated_at" is not null
        and "expected_count" = "normalized_count"
        and "normalized_count" = "published_count"
      ))
);
--> statement-breakpoint
CREATE TABLE "ingest"."raw_blob" (
	"content_sha256" char(64) PRIMARY KEY,
	"object_key" text NOT NULL CONSTRAINT "raw_blob_object_key_key" UNIQUE,
	"byte_length" bigint NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"content_encoding" varchar(64) NOT NULL,
	"stored_at" timestamp with time zone NOT NULL,
	CONSTRAINT "raw_blob_byte_length_nonnegative" CHECK ("byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."raw_observation" (
	"observation_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest"."raw_observation_observation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"request_unit_id" bigint NOT NULL,
	"source" varchar(64) NOT NULL,
	"endpoint" text NOT NULL,
	"request_params" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"http_status" bigint NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"source_entity_id" text,
	"schema_fingerprint" char(64),
	"parser_status" varchar(16) NOT NULL,
	"quarantine_reason" text,
	CONSTRAINT "raw_observation_parser_status_allowed" CHECK ("parser_status" in ('pending', 'normalized', 'quarantined'))
);
--> statement-breakpoint
CREATE TABLE "ingest"."request_unit" (
	"request_unit_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest"."request_unit_request_unit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"source" varchar(64) NOT NULL,
	"endpoint" text NOT NULL,
	"request_params" jsonb NOT NULL,
	"request_params_hash" char(64) NOT NULL,
	"expected_count" bigint NOT NULL,
	"observed_count" bigint NOT NULL,
	"status" varchar(16) NOT NULL,
	CONSTRAINT "request_unit_run_source_endpoint_params_key" UNIQUE("run_id","source","endpoint","request_params_hash"),
	CONSTRAINT "request_unit_expected_count_nonnegative" CHECK ("expected_count" >= 0),
	CONSTRAINT "request_unit_observed_count_nonnegative" CHECK ("observed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ingest"."normalized_record" ADD CONSTRAINT "normalized_record_YVx965oGliOv_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" ADD CONSTRAINT "raw_observation_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" ADD CONSTRAINT "raw_observation_mxWqbwvUOxBy_fkey" FOREIGN KEY ("request_unit_id") REFERENCES "ingest"."request_unit"("request_unit_id");--> statement-breakpoint
ALTER TABLE "ingest"."raw_observation" ADD CONSTRAINT "raw_observation_content_sha256_raw_blob_content_sha256_fkey" FOREIGN KEY ("content_sha256") REFERENCES "ingest"."raw_blob"("content_sha256");--> statement-breakpoint
ALTER TABLE "ingest"."request_unit" ADD CONSTRAINT "request_unit_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");