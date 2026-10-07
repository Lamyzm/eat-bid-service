-- `source_payload` jsonb 경로로 읽던 값 넷을 열로 옮기는 첫 단계다(EAT-308). 기본값 없는 null 열이라 표를 다시 쓰지
-- 않고 카탈로그만 바뀐다. 다만 ACCESS EXCLUSIVE를 잠깐 잡으므로 백업(pg_dump)이 도는 동안에는 lock_timeout(5초)에
-- 걸린다. 기존 126만 행을 여기서 채우지 않는 이유: 열을 더한 트랜잭션은 끝날 때까지 표 전체를 잠그므로 같은 자리에서
-- jsonb 7GB를 읽어 갱신하면 그동안 화면 조회가 모두 멈춘다. `backfill-revision-columns` entrypoint가 나눠 채운다.
ALTER TABLE "core"."auction_revision" ADD COLUMN "roster_submission_count" integer;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD COLUMN "source_roster_size" integer;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD COLUMN "source_category_label" text;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD COLUMN "lineage_observed" boolean;
