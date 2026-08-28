-- 서빙 DB 스키마 — 멱등(idempotent). 어떤 상황에서 실행돼도 데이터를 지우지 않는다.
--   * 전 테이블 CREATE TABLE IF NOT EXISTS
--   * 컬럼 추가는 하단 ALTER ... ADD COLUMN IF NOT EXISTS 블록에 병기
--   * 재적재 시 초기화는 로더(tools/serve/load_postgres.py)가 명시적 DELETE로 수행
--   * 개발용 완전 초기화는 reset-dev.sql (별도 파일, 수동 실행)
CREATE TABLE IF NOT EXISTS "firm_bids" (
	"bid_id" varchar(32),
	"biz_no" varchar(16),
	"bid_rate" double precision,
	"won" integer DEFAULT 0 NOT NULL,
	"opened_at" date,
	"floor_rate" double precision,
	"win_rate" double precision,
	"base_price" bigint,
	"sigungu" varchar(40),
	"school_name" varchar(160),
	CONSTRAINT "firm_bids_pkey" PRIMARY KEY("bid_id","biz_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "firms" (
	"biz_no" varchar(16) PRIMARY KEY,
	"name" varchar(128) NOT NULL,
	"regions" jsonb DEFAULT '[]' NOT NULL,
	"first_seen" date,
	"last_seen" date,
	"total_bids" integer DEFAULT 0 NOT NULL,
	"total_wins" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_regions" (
	"sido" varchar(40) NOT NULL,
	"sigungu" varchar(40),
	"category" varchar(20),
	"per_year" integer NOT NULL,
	"med_field" integer NOT NULL,
	"exp_win" double precision NOT NULL,
	"med_base" bigint,
	"market_yr" bigint,
	"top5_share" integer,
	"detail" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	-- sido 가 빠져 있었다. 집계 키는 (sido,sgg,cat) 인데 충돌 대상이 (sgg,cat) 이라
	-- "남구"처럼 여러 시도에 있는 이름(51개)이 품목당 1행으로 뭉개졌다 — 어느 도시가
	-- 살아남는지는 insert 순서가 정했다. 시장 지도가 도시를 뒤섞어 보여주고 있었다.
	CONSTRAINT "market_regions_pkey" PRIMARY KEY("sido","sigungu","category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_auctions" (
	"bid_no" varchar(32) PRIMARY KEY,
	"school_name" varchar(160),
	"sigungu" varchar(40),
	"allowed_regions" jsonb DEFAULT '[]' NOT NULL,
	"base_price" bigint,
	"floor_rate" double precision,
	"category" varchar(20),
	"deadline" timestamp,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "school_auctions" (
	"bid_id" varchar(32) PRIMARY KEY,
	"school_id" varchar(200) NOT NULL,
	"category" varchar(20),
	"opened_at" date NOT NULL,
	"floor_rate" double precision,
	"base_price" bigint,
	"win_rate" double precision,
	"n_valid" integer NOT NULL,
	"winner_biz_no" varchar(16),
	"planned_price" bigint,
	"dlvry_start" date,
	"dlvry_end" date,
	"reserves" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "school_roster" (
	"school_id" varchar(200),
	"biz_no" varchar(16),
	"name" varchar(128),
	"part_n" integer NOT NULL,
	"win_n" integer DEFAULT 0 NOT NULL,
	"win_rates" jsonb DEFAULT '[]' NOT NULL,
	"med_rate" double precision,
	CONSTRAINT "school_roster_pkey" PRIMARY KEY("school_id","biz_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schools" (
	"id" varchar(200) PRIMARY KEY,
	"name" varchar(160) NOT NULL,
	"sido" varchar(40) NOT NULL,
	"sigungu" varchar(40) NOT NULL,
	"category" varchar(20) NOT NULL,
	"n_auctions" integer NOT NULL,
	"med_field" integer NOT NULL,
	"med_base" bigint,
	"rsd" double precision,
	"by_floor" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_biz" (
	"workspace_id" varchar(64),
	"biz_no" varchar(16),
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_biz_pkey" PRIMARY KEY("workspace_id","biz_no")
);

-- 조회 인덱스 (몰림·성적·뱃지·회차 경계)
CREATE INDEX IF NOT EXISTS idx_firm_bids_biz ON firm_bids (biz_no);
CREATE INDEX IF NOT EXISTS idx_firm_bids_floor_opened ON firm_bids (floor_rate, opened_at);
CREATE INDEX IF NOT EXISTS idx_firm_bids_school ON firm_bids (school_name);
CREATE INDEX IF NOT EXISTS idx_school_auctions_school ON school_auctions (school_id);
CREATE INDEX IF NOT EXISTS idx_school_auctions_opened ON school_auctions (opened_at);

-- 사용 이벤트 (게이트 측정) — DROP 프리앰블에서 제외: 재적재에도 보존
CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY,
	"ts" timestamptz DEFAULT now() NOT NULL,
	"session" varchar(64) NOT NULL,
	"screen" varchar(40) NOT NULL,
	"meta" jsonb
);
CREATE INDEX IF NOT EXISTS idx_events_screen_ts ON "events" (screen, ts);

-- 라이브 마이그레이션 병기 (qa 사고 교훈: 컬럼 추가는 CREATE와 함께 ALTER도)
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "dlvry_start" date;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "dlvry_end" date;

-- ─── 인증 + 사용자 데이터 (DROP 프리앰블 제외: 재적재에도 보존) ───
CREATE TABLE IF NOT EXISTS "user" (
	"id" varchar(64) PRIMARY KEY,
	"name" varchar(200),
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
CREATE TABLE IF NOT EXISTS "session" (
	"id" varchar(64) PRIMARY KEY,
	"user_id" varchar(64) NOT NULL,
	"token" varchar(400) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token ON "session" (token);
CREATE TABLE IF NOT EXISTS "account" (
	"id" varchar(64) PRIMARY KEY,
	"user_id" varchar(64) NOT NULL,
	"issuer" varchar(200) NOT NULL DEFAULT '',
	"account_id" varchar(200) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"access_token" varchar(2000),
	"refresh_token" varchar(2000),
	"id_token" varchar(2000),
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" varchar(500),
	"password" varchar(400),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "verification" (
	"id" varchar(64) PRIMARY KEY,
	"identifier" varchar(320) NOT NULL,
	"value" varchar(400) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_biz" (
	"user_id" varchar(64) NOT NULL,
	"biz_no" varchar(16) NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_biz_pkey" PRIMARY KEY("user_id","biz_no")
);
CREATE TABLE IF NOT EXISTS "user_region" (
	"user_id" varchar(64) NOT NULL,
	"sigungu" varchar(40) NOT NULL,
	CONSTRAINT "user_region_pkey" PRIMARY KEY("user_id","sigungu")
);
CREATE TABLE IF NOT EXISTS "user_mark" (
	"user_id" varchar(64) NOT NULL,
	"bid_no" varchar(32) NOT NULL,
	"biz_no" varchar(16) NOT NULL DEFAULT '',
	"status" varchar(8) NOT NULL,
	"rate" double precision,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mark_pkey" PRIMARY KEY("user_id","bid_no","biz_no")
);
-- 라이브 마이그레이션 병기
ALTER TABLE "user_mark" ADD COLUMN IF NOT EXISTS "rate" double precision;

-- better-auth 1.7.x 스키마 동기화 (라이브 마이그레이션)
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" varchar(200) NOT NULL DEFAULT '';

-- 데이터 테이블 컬럼 마이그레이션 (기존 DB 대상, 멱등)
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "planned_price" bigint;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "reserves" jsonb;

-- ─── S-1 품목 축 (멱등·추가만) ───
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "cat_counts" jsonb;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "by_cat_floor" jsonb;
CREATE TABLE IF NOT EXISTS "school_roster_cat" (
	"school_id" varchar(200) NOT NULL,
	"category" varchar(16) NOT NULL,
	"biz_no" varchar(16) NOT NULL,
	"name" varchar(128),
	"part_n" integer NOT NULL,
	"win_n" integer DEFAULT 0 NOT NULL,
	"win_rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"med_rate" double precision,
	CONSTRAINT "school_roster_cat_pkey" PRIMARY KEY("school_id","category","biz_no")
);

-- user_mark 사업자 축 (무손실: 컬럼 추가 + 기본키 교체. 행 삭제 없음)
ALTER TABLE user_mark ADD COLUMN IF NOT EXISTS "biz_no" varchar(16) NOT NULL DEFAULT '';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mark_pkey'
             AND conrelid = 'user_mark'::regclass
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, bid_no)') THEN
    ALTER TABLE user_mark DROP CONSTRAINT user_mark_pkey;
    ALTER TABLE user_mark ADD CONSTRAINT user_mark_pkey PRIMARY KEY (user_id, bid_no, biz_no);
  END IF;
END $$;

-- 품목 다중화 (S-1 후속) — 추가만. 기존 category 는 대표로 유지된다.
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "categories" jsonb;
ALTER TABLE school_auctions ADD COLUMN IF NOT EXISTS "category_src" varchar(16);
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "categories" jsonb;
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "category_src" varchar(16);

-- 학교 정체성 키 (A-8 분리 / A-9 병합 감지용). 추가만 — schools.id 는 불변.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS "purr_cd" varchar(32);
CREATE INDEX IF NOT EXISTS idx_schools_purr_cd ON schools (purr_cd);

-- market_regions PK 에 sido 추가 (2026-08-28). 기존 PK 가 (sigungu,category) 라
-- 여러 시도의 같은 이름이 한 행으로 뭉개졌다. 데이터는 재적재가 다시 채운다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname='market_regions' AND c.conname='market_regions_pkey'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (sigungu, category)'
  ) THEN
    ALTER TABLE "market_regions" DROP CONSTRAINT "market_regions_pkey";
    ALTER TABLE "market_regions" ADD CONSTRAINT "market_regions_pkey"
      PRIMARY KEY ("sido","sigungu","category");
  END IF;
END $$;

-- 투찰 마감·시작 시각. deadline(개찰)과 별개다 — 덮어쓰지 않는다.
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "bid_end_at" timestamp;
ALTER TABLE open_auctions ADD COLUMN IF NOT EXISTS "bid_begin_at" timestamp;
