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
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_code_value_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_code_release_fkey" FOREIGN KEY ("code_release_id") REFERENCES "core"."code_release"("code_release_id");--> statement-breakpoint
ALTER TABLE "core"."code_value_coordinate" ADD CONSTRAINT "code_value_coordinate_evidence_fkey" FOREIGN KEY ("evidence_observation_id") REFERENCES "ingest"."raw_observation"("observation_id");