CREATE TABLE "mart"."build" (
	"build_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mart"."build_build_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"mart_name" varchar(64) NOT NULL,
	"source_release_id" uuid NOT NULL,
	"publication_id" uuid,
	"calc_version" varchar(32) NOT NULL,
	"builder_version" varchar(64) NOT NULL,
	"region_scheme" varchar(64),
	"status" varchar(16) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"row_count" bigint,
	"retain_until" timestamp with time zone,
	"failure_category" varchar(64),
	CONSTRAINT "mart_build_idempotency_key" UNIQUE NULLS NOT DISTINCT("mart_name","calc_version","source_release_id","publication_id"),
	CONSTRAINT "mart_build_name_allowed" CHECK ("mart_name" in ('org_round_summary', 'win_rate_distribution_monthly', 'open_auction_snapshot')),
	CONSTRAINT "mart_build_status_allowed" CHECK ("status" in ('building', 'verified', 'active', 'superseded', 'failed')),
	CONSTRAINT "mart_build_builder_version_build_sha" CHECK ("builder_version" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "mart_build_row_count_nonnegative" CHECK ("row_count" is null or "row_count" >= 0),
	CONSTRAINT "mart_build_verified_requires_evidence" CHECK ("status" not in ('verified', 'active', 'superseded')
        or ("computed_at" is not null and "row_count" is not null)),
	CONSTRAINT "mart_build_active_requires_activation" CHECK ("status" <> 'active'
        or ("activated_at" is not null and "failure_category" is null and "superseded_at" is null)),
	CONSTRAINT "mart_build_superseded_requires_timestamp" CHECK ("status" <> 'superseded' or ("superseded_at" is not null and "activated_at" is not null)),
	CONSTRAINT "mart_build_failed_requires_category" CHECK (("status" = 'failed') = ("failure_category" is not null)),
	CONSTRAINT "mart_build_failed_is_never_activated" CHECK ("status" <> 'failed' or "activated_at" is null),
	CONSTRAINT "mart_build_activation_chronology" CHECK ("activated_at" is null or "computed_at" is null or "activated_at" >= "computed_at"),
	CONSTRAINT "mart_build_supersession_chronology" CHECK ("superseded_at" is null or "activated_at" is null or "superseded_at" >= "activated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mart_build_active_key" ON "mart"."build" ("mart_name") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "mart_build_mart_status_idx" ON "mart"."build" ("mart_name","status");--> statement-breakpoint
ALTER TABLE "mart"."build" ADD CONSTRAINT "build_source_release_id_source_release_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ingest"."source_release"("source_release_id");--> statement-breakpoint
ALTER TABLE "mart"."build" ADD CONSTRAINT "build_publication_id_publication_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "ingest"."publication"("publication_id");
--> statement-breakpoint
CREATE FUNCTION "mart"."enforce_mart_build_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('active', 'superseded') THEN
      RAISE EXCEPTION 'published mart build lineage is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'building' THEN
      RAISE EXCEPTION 'mart build must start in the building state'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> NEW."status" AND NOT (
    (OLD."status" = 'building' AND NEW."status" IN ('verified', 'failed'))
    OR (OLD."status" = 'verified' AND NEW."status" = 'active')
    OR (OLD."status" = 'active' AND NEW."status" = 'superseded')
  ) THEN
    RAISE EXCEPTION 'mart build transition % -> % is not allowed', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IN ('active', 'superseded') AND (
    OLD."mart_name" <> NEW."mart_name"
    OR OLD."source_release_id" <> NEW."source_release_id"
    OR OLD."calc_version" <> NEW."calc_version"
    OR OLD."builder_version" <> NEW."builder_version"
    OR OLD."row_count" IS DISTINCT FROM NEW."row_count"
  ) THEN
    RAISE EXCEPTION 'published mart build lineage is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "mart"."enforce_mart_row_build_is_building"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_build_id bigint;
  row_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."build_id" <> NEW."build_id" THEN
    RAISE EXCEPTION 'mart row cannot move between builds'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    row_build_id := OLD."build_id";
  ELSE
    row_build_id := NEW."build_id";
  END IF;

  SELECT "status" INTO row_status FROM "mart"."build" WHERE "build_id" = row_build_id;

  IF TG_OP = 'DELETE' THEN
    IF row_status IS NULL OR row_status NOT IN ('building', 'failed', 'superseded') THEN
      RAISE EXCEPTION 'mart rows of an active build cannot be deleted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF row_status IS DISTINCT FROM 'building' THEN
    RAISE EXCEPTION 'mart rows can only be written while the build is building'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "mart_build_transition"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."build"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_build_transition"();