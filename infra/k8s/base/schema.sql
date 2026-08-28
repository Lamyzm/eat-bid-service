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
	CONSTRAINT "market_regions_pkey" PRIMARY KEY("sigungu","category")
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
	"status" varchar(8) NOT NULL,
	"rate" double precision,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mark_pkey" PRIMARY KEY("user_id","bid_no")
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
