-- 그린필드 전환 전 레거시 `public` 스키마의 표 18개와 시퀀스 1개(약 2.9GB)를 지운다(EAT-312, AGENTS 12). 보존할 것은 R2
-- `archive/legacy-public/20261007-legacy-public.dump`(custom format, 342,411,249 bytes)에 따로 보관했다.
-- 2026-10-07 운영 실측에서 다른 스키마가 참조하는 FK·함수가 없고, Postgres 재시작 이후 넣기·고치기·색인 조회가
-- 0건이며 읽은 것은 백업(pg_dump)뿐이었다.
--
-- IF EXISTS인 이유: Drizzle이 이 표들을 만든 적이 없어 처음부터 마이그레이션한 DB(CI·dev)에는 없다. 백업이 도는
-- 동안에는 pg_dump가 잡은 ACCESS SHARE 때문에 lock_timeout(5초)에 걸리므로 백업이 끝난 뒤 동기화한다.
DROP TABLE IF EXISTS
  "public"."account",
  "public"."events",
  "public"."firm_bids",
  "public"."firms",
  "public"."market_regions",
  "public"."open_auctions",
  "public"."run_log",
  "public"."school_auctions",
  "public"."school_roster",
  "public"."school_roster_cat",
  "public"."schools",
  "public"."session",
  "public"."user",
  "public"."user_biz",
  "public"."user_mark",
  "public"."user_region",
  "public"."verification",
  "public"."workspace_biz";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "public"."events_id_seq";
