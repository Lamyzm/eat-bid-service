-- 업체명 관측 행을 이름 관측 표에서 지운다(EAT-314, ADR 0063). 업체명은 이제 그 이름이 관측된 투찰 행의
-- `supplier_label`이고, 이 행들은 그 표의 93%(2026-10-07 운영 약 4,750만 행·14.2GB 중 대부분)였다.
--
-- 가드가 먼저다. 업체명 관측은 있는데 그 투찰 행의 `supplier_label`이 비어 있으면 `backfill-supplier-labels`가
-- 아직 끝나지 않은 것이다. 그 상태로 지우면 옛 명단의 업체명을 잃으므로 여기서 실패하고 전부 되감는다.
-- 투찰 표를 한 번 훑는다(운영 약 13GB, 문장 제한 5분 안).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "core"."bid_submission" AS submission
      JOIN "core"."source_supplier_account" AS account
        ON account."source_supplier_account_id" = submission."source_supplier_account_id"
      JOIN "core"."code_label_observation" AS label
        ON label."code_value_id" = account."account_code_value_id"
       AND label."observation_id" = submission."observation_id"
     WHERE submission."supplier_label" IS NULL
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'supplier labels are not backfilled: run backfill-supplier-labels before this migration';
  END IF;
END $$;--> statement-breakpoint
-- 남길 행(기관·지역·참가제한지역·투찰 상태 라벨, 2026-10-07 운영 4,986,431행·고르는 데 5초)을 옮겨 두고 표를 TRUNCATE한 뒤 되돌려 넣는다.
-- 4,750만 행 DELETE는 문장 제한을 넘고 죽은 행이 VACUUM FULL 전까지 디스크를 쥔다. TRUNCATE는 커밋 순간 파일을
-- 돌려준다. 이 표를 FK로 가리키는 표가 없고, TRUNCATE는 identity 순번을 되감지 않으므로 옛 id가 그대로 남는다.
-- 옮겨 둘 표는 UNLOGGED다 — 같은 트랜잭션에서 지우는 중간물이라 WAL을 쓸 이유가 없다.
CREATE UNLOGGED TABLE "core"."code_label_observation_kept" AS
  SELECT label.*
    FROM "core"."code_label_observation" AS label
    JOIN "core"."code_value" AS value ON value."code_value_id" = label."code_value_id"
    JOIN "core"."code_scheme" AS scheme ON scheme."code_scheme_id" = value."code_scheme_id"
   WHERE scheme."namespace" <> 'eat:supplier-account';--> statement-breakpoint
TRUNCATE "core"."code_label_observation";--> statement-breakpoint
INSERT INTO "core"."code_label_observation" OVERRIDING SYSTEM VALUE
  SELECT * FROM "core"."code_label_observation_kept";--> statement-breakpoint
DROP TABLE "core"."code_label_observation_kept";
