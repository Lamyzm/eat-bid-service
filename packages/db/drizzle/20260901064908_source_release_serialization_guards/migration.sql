-- Custom SQL migration file, put your code below! --
DROP TRIGGER "source_release_seal_completeness" ON "ingest"."source_release";
--> statement-breakpoint
DROP TRIGGER "source_release_sealed_immutable" ON "ingest"."source_release";
--> statement-breakpoint
DROP FUNCTION "ingest"."enforce_source_release_seal_completeness"();
--> statement-breakpoint
DROP FUNCTION "ingest"."prevent_sealed_source_release_mutation"();
--> statement-breakpoint
DROP TRIGGER "source_release_run_sealed_immutable" ON "ingest"."source_release_run";
--> statement-breakpoint
DROP TRIGGER "source_release_observation_sealed_immutable" ON "ingest"."source_release_observation";
--> statement-breakpoint
DROP TRIGGER "source_release_dataset_sealed_immutable" ON "ingest"."source_release_dataset";
--> statement-breakpoint
DROP FUNCTION "ingest"."prevent_sealed_source_release_membership_mutation"();
--> statement-breakpoint
CREATE FUNCTION "ingest"."enforce_source_release_state_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'planned' THEN
      RAISE EXCEPTION 'source release must be inserted planned'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'sealed' THEN
      RAISE EXCEPTION 'sealed source release is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'failed' THEN
      RAISE EXCEPTION 'failed source release is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'sealed' THEN
    RAISE EXCEPTION 'sealed source release is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'failed' THEN
    RAISE EXCEPTION 'failed source release is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" = 'sealed' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "ingest"."source_release_dataset" AS dataset
      WHERE dataset."source_release_id" = NEW."source_release_id"
        AND dataset."required"
    ) THEN
      RAISE EXCEPTION 'sealed source release requires at least one required dataset'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
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
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "ingest"."enforce_source_release_membership_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_release record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR parent_release IN
      SELECT "source_release_id", "status"
      FROM "ingest"."source_release"
      WHERE "source_release_id" = NEW."source_release_id"
      ORDER BY "source_release_id"
      FOR UPDATE
    LOOP
      IF parent_release."status" = 'sealed' THEN
        RAISE EXCEPTION 'sealed source release membership is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
      IF parent_release."status" = 'failed' THEN
        RAISE EXCEPTION 'failed source release membership is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    FOR parent_release IN
      SELECT "source_release_id", "status"
      FROM "ingest"."source_release"
      WHERE "source_release_id" = OLD."source_release_id"
      ORDER BY "source_release_id"
      FOR UPDATE
    LOOP
      IF parent_release."status" = 'sealed' THEN
        RAISE EXCEPTION 'sealed source release membership is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
      IF parent_release."status" = 'failed' THEN
        RAISE EXCEPTION 'failed source release membership is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    RETURN OLD;
  END IF;

  FOR parent_release IN
    SELECT "source_release_id", "status"
    FROM "ingest"."source_release"
    WHERE "source_release_id" IN (OLD."source_release_id", NEW."source_release_id")
    ORDER BY "source_release_id"
    FOR UPDATE
  LOOP
    IF parent_release."status" = 'sealed' THEN
      RAISE EXCEPTION 'sealed source release membership is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF parent_release."status" = 'failed' THEN
      RAISE EXCEPTION 'failed source release membership is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "source_release_state_transition"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."enforce_source_release_state_transition"();
--> statement-breakpoint
CREATE TRIGGER "source_release_run_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_run"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."enforce_source_release_membership_mutation"();
--> statement-breakpoint
CREATE TRIGGER "source_release_observation_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_observation"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."enforce_source_release_membership_mutation"();
--> statement-breakpoint
CREATE TRIGGER "source_release_dataset_sealed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_release_dataset"
FOR EACH ROW
EXECUTE FUNCTION "ingest"."enforce_source_release_membership_mutation"();
