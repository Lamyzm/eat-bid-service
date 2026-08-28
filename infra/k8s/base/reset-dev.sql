-- ⚠ 개발용 완전 초기화 — 데이터 테이블을 전부 삭제한다. 운영/공용 DB에서 실행 금지.
-- 계정(user/session/account/verification)·사용자 데이터(user_*)·events는 여기서도 건드리지 않는다.
-- 사용: kubectl -n eatbid exec -i deploy/postgres -- psql -U eatbid -d eatbid < reset-dev.sql
--       그 뒤 반드시 schema.sql 재실행 + 로더 재적재.

DROP TABLE IF EXISTS "school_roster" CASCADE;
DROP TABLE IF EXISTS "firm_bids" CASCADE;
DROP TABLE IF EXISTS "firms" CASCADE;
DROP TABLE IF EXISTS "market_regions" CASCADE;
DROP TABLE IF EXISTS "open_auctions" CASCADE;
DROP TABLE IF EXISTS "school_auctions" CASCADE;
DROP TABLE IF EXISTS "schools" CASCADE;
DROP TABLE IF EXISTS "workspace_biz" CASCADE;
