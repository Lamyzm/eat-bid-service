-- 업체명을 그 이름이 관측된 투찰 행에 둔다(ADR 0063, EAT-310). 기본값 없는 null 열이라 PostgreSQL 11+에서는
-- 표를 다시 쓰지 않고 카탈로그만 바뀐다. 다만 부모와 모든 연도 파티션에 ACCESS EXCLUSIVE를 잠깐 잡으므로
-- 백업(pg_dump)이 도는 동안에는 lock_timeout(5초)에 걸려 실패한다 — 백업이 끝난 뒤 다시 동기화하면 된다.
-- 기존 4,596만 행은 여기서 채우지 않는다. 한 트랜잭션 갱신은 표를 두 벌로 만들고 문장 제한(5분)을 넘으므로
-- `backfill-supplier-labels` entrypoint가 업체 범위로 나눠 커밋하며 채운다.
ALTER TABLE "core"."bid_submission" ADD COLUMN "supplier_label" text;
