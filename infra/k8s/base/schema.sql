-- dev reset
DROP TABLE IF EXISTS "school_roster" CASCADE;
DROP TABLE IF EXISTS "firm_bids" CASCADE;
DROP TABLE IF EXISTS "firms" CASCADE;
DROP TABLE IF EXISTS "market_regions" CASCADE;
DROP TABLE IF EXISTS "open_auctions" CASCADE;
DROP TABLE IF EXISTS "school_auctions" CASCADE;
DROP TABLE IF EXISTS "schools" CASCADE;
DROP TABLE IF EXISTS "workspace_biz" CASCADE;
CREATE TABLE "firm_bids" (
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
CREATE TABLE "firms" (
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
CREATE TABLE "market_regions" (
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
CREATE TABLE "open_auctions" (
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
CREATE TABLE "school_auctions" (
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
CREATE TABLE "school_roster" (
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
CREATE TABLE "schools" (
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
CREATE TABLE "workspace_biz" (
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
