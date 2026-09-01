CREATE UNIQUE INDEX "source_release_source_manifest_sha256_key" ON "ingest"."source_release" ("source","manifest_sha256") WHERE "manifest_sha256" is not null;--> statement-breakpoint
ALTER TABLE "ingest"."source_release_dataset" ADD CONSTRAINT "source_release_dataset_observed_count_not_above_expected" CHECK ("observed_count" <= "expected_count");--> statement-breakpoint
ALTER TABLE "ingest"."source_release_dataset" ADD CONSTRAINT "source_release_dataset_terminal_count_not_above_observed" CHECK ("normalized_count" + "quarantined_count" <= "observed_count");
--> statement-breakpoint
CREATE FUNCTION "ingest"."enforce_source_release_seal_completeness"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'sealed' AND EXISTS (
    SELECT 1
    FROM "ingest"."source_release_dataset" AS dataset
    WHERE dataset."source_release_id" = NEW."source_release_id"
      AND dataset."required"
      AND (
        dataset."observed_count" <> dataset."expected_count"
        OR dataset."normalized_count" + dataset."quarantined_count" <> dataset."observed_count"
      )
  ) THEN
    RAISE EXCEPTION 'sealed source release requires complete required datasets'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "ingest"."prevent_sealed_source_release_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'sealed' THEN
    RAISE EXCEPTION 'sealed source release is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "ingest"."prevent_sealed_source_release_membership_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1
      FROM "ingest"."source_release"
      WHERE "source_release_id" = NEW."source_release_id"
        AND "status" = 'sealed'
    ) THEN
      RAISE EXCEPTION 'sealed source release membership is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM "ingest"."source_release"
      WHERE "source_release_id" = OLD."source_release_id"
        AND "status" = 'sealed'
    ) THEN
      RAISE EXCEPTION 'sealed source release membership is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ingest"."source_release"
    WHERE "source_release_id" IN (OLD."source_release_id", NEW."source_release_id")
      AND "status" = 'sealed'
  ) THEN
    RAISE EXCEPTION 'sealed source release membership is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "source_release_seal_completeness"
BEFORE INSERT OR UPDATE ON "ingest"."source_release"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."enforce_source_release_seal_completeness"();
--> statement-breakpoint
CREATE TRIGGER "source_release_sealed_immutable"
BEFORE UPDATE OR DELETE ON "ingest"."source_release"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."prevent_sealed_source_release_mutation"();
--> statement-breakpoint
CREATE TRIGGER "source_release_run_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_run"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."prevent_sealed_source_release_membership_mutation"();
--> statement-breakpoint
CREATE TRIGGER "source_release_observation_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_observation"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."prevent_sealed_source_release_membership_mutation"();
--> statement-breakpoint
CREATE TRIGGER "source_release_dataset_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_dataset"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."prevent_sealed_source_release_membership_mutation"();
