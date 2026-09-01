CREATE TABLE "ingest"."source_release" (
	"source_release_id" uuid PRIMARY KEY,
	"source" varchar(64) NOT NULL,
	"release_name" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"manifest_sha256" char(64),
	"sealed_at" timestamp with time zone,
	"failure_category" varchar(64),
	CONSTRAINT "source_release_source_release_name_key" UNIQUE("source","release_name"),
	CONSTRAINT "source_release_status_allowed" CHECK ("status" in ('planned', 'sealed', 'failed')),
	CONSTRAINT "source_release_manifest_sha256" CHECK ("manifest_sha256" is null or "manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_release_terminal_metadata" CHECK ((
        "status" = 'sealed'
        and "manifest_sha256" is not null
        and "sealed_at" is not null
        and "failure_category" is null
      ) or (
        "status" = 'failed'
        and "manifest_sha256" is null
        and "sealed_at" is null
        and "failure_category" is not null
      ) or (
        "status" = 'planned'
        and "manifest_sha256" is null
        and "sealed_at" is null
        and "failure_category" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "ingest"."source_release_dataset" (
	"source_release_id" uuid,
	"endpoint" text NOT NULL,
	"dataset" varchar(128),
	"record_type" varchar(64) NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"schema_fingerprint" char(64) NOT NULL,
	"expected_count" bigint NOT NULL,
	"observed_count" bigint NOT NULL,
	"normalized_count" bigint NOT NULL,
	"quarantined_count" bigint NOT NULL,
	"required" boolean NOT NULL,
	CONSTRAINT "source_release_dataset_pkey" PRIMARY KEY("source_release_id","dataset"),
	CONSTRAINT "source_release_dataset_schema_fingerprint_sha256" CHECK ("schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_release_dataset_expected_count_nonnegative" CHECK ("expected_count" >= 0),
	CONSTRAINT "source_release_dataset_observed_count_nonnegative" CHECK ("observed_count" >= 0),
	CONSTRAINT "source_release_dataset_normalized_count_nonnegative" CHECK ("normalized_count" >= 0),
	CONSTRAINT "source_release_dataset_quarantined_count_nonnegative" CHECK ("quarantined_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."source_release_observation" (
	"source_release_id" uuid,
	"observation_id" bigint,
	CONSTRAINT "source_release_observation_pkey" PRIMARY KEY("source_release_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "ingest"."source_release_run" (
	"source_release_id" uuid,
	"run_id" uuid,
	CONSTRAINT "source_release_run_pkey" PRIMARY KEY("source_release_id","run_id")
);
--> statement-breakpoint
ALTER TABLE "ingest"."source_release_dataset" ADD CONSTRAINT "source_release_dataset_HS19Pl3hjraU_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ingest"."source_release"("source_release_id");--> statement-breakpoint
ALTER TABLE "ingest"."source_release_observation" ADD CONSTRAINT "source_release_observation_dufcKiIUBtW2_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ingest"."source_release"("source_release_id");--> statement-breakpoint
ALTER TABLE "ingest"."source_release_observation" ADD CONSTRAINT "source_release_observation_In0Vbhr12fDW_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "ingest"."source_release_run" ADD CONSTRAINT "source_release_run_peaRjLf0syj9_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ingest"."source_release"("source_release_id");--> statement-breakpoint
ALTER TABLE "ingest"."source_release_run" ADD CONSTRAINT "source_release_run_run_id_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("run_id");