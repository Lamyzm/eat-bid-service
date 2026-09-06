CREATE TABLE "core"."code_release" (
	"code_release_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_release_code_release_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_release_id" uuid NOT NULL,
	"code_scheme_id" bigint NOT NULL,
	"source_version" varchar(128) NOT NULL,
	"published_at" timestamp with time zone,
	"promoted_grain" text[] NOT NULL,
	"source_row_count" integer NOT NULL,
	"member_count" integer NOT NULL,
	"excluded_row_count" integer NOT NULL,
	CONSTRAINT "code_release_source_release_scheme_key" UNIQUE("source_release_id","code_scheme_id"),
	CONSTRAINT "code_release_promoted_grain_present" CHECK (array_length("promoted_grain", 1) >= 1),
	CONSTRAINT "code_release_row_counts_nonnegative" CHECK ("source_row_count" >= 0 and "member_count" >= 0 and "excluded_row_count" >= 0),
	CONSTRAINT "code_release_row_counts_partition_source" CHECK ("member_count" + "excluded_row_count" = "source_row_count")
);
--> statement-breakpoint
CREATE TABLE "core"."code_release_member" (
	"code_release_id" bigint,
	"code_value_id" bigint,
	"parent_code_value_id" bigint,
	"grain" varchar(64) NOT NULL,
	"active" boolean NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	CONSTRAINT "code_release_member_pkey" PRIMARY KEY("code_release_id","code_value_id"),
	CONSTRAINT "code_release_member_parent_is_not_self" CHECK ("parent_code_value_id" is distinct from "code_value_id"),
	CONSTRAINT "code_release_member_valid_time_order" CHECK ("valid_to" is null or "valid_from" is null or "valid_to" >= "valid_from")
);
--> statement-breakpoint
CREATE TABLE "core"."code_value_coordinate" (
	"code_value_coordinate_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_value_coordinate_code_value_coordinate_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code_value_id" bigint NOT NULL,
	"code_release_id" bigint NOT NULL,
	"latitude" numeric(9,6) NOT NULL,
	"longitude" numeric(9,6) NOT NULL,
	"crs" varchar(32) NOT NULL,
	"evidence_observation_id" bigint NOT NULL,
	CONSTRAINT "code_value_coordinate_release_code_key" UNIQUE("code_release_id","code_value_id"),
	CONSTRAINT "code_value_coordinate_crs_allowed" CHECK ("crs" = 'EPSG:4326'),
	CONSTRAINT "code_value_coordinate_within_earth" CHECK ("latitude" between -90 and 90 and "longitude" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "core"."code_release" ADD CONSTRAINT "code_release_code_scheme_id_code_scheme_code_scheme_id_fkey" FOREIGN KEY ("code_scheme_id") REFERENCES "core"."code_scheme"("code_scheme_id");--> statement-breakpoint
ALTER TABLE "core"."code_release" ADD CONSTRAINT "code_release_source_release_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ingest"."source_release"("source_release_id");--> statement-breakpoint
ALTER TABLE "core"."code_release_member" ADD CONSTRAINT "code_release_member_code_value_id_code_value_code_value_id_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_release_member" ADD CONSTRAINT "code_release_member_release_fkey" FOREIGN KEY ("code_release_id") REFERENCES "core"."code_release"("code_release_id");--> statement-breakpoint
ALTER TABLE "core"."code_release_member" ADD CONSTRAINT "code_release_member_parent_fkey" FOREIGN KEY ("code_release_id","parent_code_value_id") REFERENCES "core"."code_release_member"("code_release_id","code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_code_value_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_code_release_fkey" FOREIGN KEY ("code_release_id") REFERENCES "core"."code_release"("code_release_id");--> statement-breakpoint
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_evidence_fkey" FOREIGN KEY ("evidence_observation_id") REFERENCES "ingest"."raw_observation"("observation_id");