-- dev reset
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
	"opened_at" date NOT NULL,
	"floor_rate" double precision,
	"base_price" bigint,
	"win_rate" double precision,
	"n_valid" integer NOT NULL,
	"winner_biz_no" varchar(16)
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
