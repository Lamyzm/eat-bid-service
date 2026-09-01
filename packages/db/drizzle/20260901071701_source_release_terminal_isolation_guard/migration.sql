CREATE OR REPLACE FUNCTION "ingest"."enforce_source_release_state_transition"()
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

  IF NEW."status" IN ('sealed', 'failed') AND NEW."status" <> OLD."status"
    AND current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'source release terminal transition requires read committed isolation'
      USING ERRCODE = 'invalid_transaction_state';
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
