-- revision의 jsonb 사본을 걷어 내는 둘째 단계다(EAT-308). 사본은 `normalized_record_id`가 가리키는 정규화 기록과 같고,
-- 읽는 쪽은 이 배포부터 열 넷과 `announced_at`만 읽는다. DROP COLUMN은 카탈로그만 바꾸며 7GB는 VACUUM FULL이
-- 표를 다시 쓸 때 돌아온다.
--
-- SET NOT NULL은 표를 한 번 훑어 null이 없는지 확인한다. `backfill-revision-columns`가 옛 행을 다 채우기 전에 이
-- 마이그레이션이 돌면 여기서 실패하고 같은 트랜잭션의 DROP COLUMN까지 되감긴다 — 채우기를 건너뛰고 사본을 잃는
-- 순서를 막는 장치다. ACCESS EXCLUSIVE를 잡으므로 백업(pg_dump)이 끝난 뒤 동기화한다.
ALTER TABLE "core"."auction_revision" DROP COLUMN "source_payload";--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ALTER COLUMN "lineage_observed" SET NOT NULL;
