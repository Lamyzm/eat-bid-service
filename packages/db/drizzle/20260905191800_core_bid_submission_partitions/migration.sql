-- drizzle-kit이 표현하지 못하는 PARTITION BY와 연도 파티션은 손으로 이어 붙였다(ADR 0033 §3).
-- snapshot.json은 손대지 않는다. 경계 문자열의 +09는 개찰 연도를 한국 시간으로 센다는 뜻이며
-- UTC 자정과 9시간 어긋나는 것이 의도다. 이 손편집이 사라지지 않도록 packages/db/src/partitioning.test.ts가
-- 이 파일을 직접 읽어 단언한다.
CREATE TABLE "core"."bid_submission" (
	"bid_submission_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "core"."bid_submission_bid_submission_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_revision_id" bigint NOT NULL,
	"auction_attempt_id" bigint NOT NULL,
	"opened_at" timestamp with time zone,
	"roster_ordinal" integer NOT NULL,
	"source_supplier_account_id" bigint NOT NULL,
	"supplier_party_id" bigint NOT NULL,
	"submitted_at" timestamp with time zone,
	"amount" numeric(18,2) NOT NULL,
	"effective_amount" numeric(18,2),
	"currency" char(3) NOT NULL,
	"bid_rate" numeric(15,3) NOT NULL,
	"rank" integer,
	"source_status_code_value_id" bigint NOT NULL,
	"withdrawal_code_value_id" bigint,
	"draw_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"observed_roster_size" integer,
	"observation_id" bigint NOT NULL,
	CONSTRAINT "bid_submission_surrogate_key" UNIQUE NULLS NOT DISTINCT("bid_submission_id","opened_at"),
	CONSTRAINT "bid_submission_roster_grain_key" UNIQUE NULLS NOT DISTINCT("auction_revision_id","roster_ordinal","opened_at")
) PARTITION BY RANGE ("opened_at");
--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2023" PARTITION OF "core"."bid_submission"
	FOR VALUES FROM ('2023-01-01 00:00:00+09') TO ('2024-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2024" PARTITION OF "core"."bid_submission"
	FOR VALUES FROM ('2024-01-01 00:00:00+09') TO ('2025-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2025" PARTITION OF "core"."bid_submission"
	FOR VALUES FROM ('2025-01-01 00:00:00+09') TO ('2026-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2026" PARTITION OF "core"."bid_submission"
	FOR VALUES FROM ('2026-01-01 00:00:00+09') TO ('2027-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2027" PARTITION OF "core"."bid_submission"
	FOR VALUES FROM ('2027-01-01 00:00:00+09') TO ('2028-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_unpartitioned" PARTITION OF "core"."bid_submission" DEFAULT;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_attempt_pair_key" UNIQUE("auction_revision_id","auction_attempt_id");--> statement-breakpoint
CREATE INDEX "bid_submission_auction_attempt_idx" ON "core"."bid_submission" ("auction_attempt_id");--> statement-breakpoint
CREATE INDEX "bid_submission_supplier_party_opened_idx" ON "core"."bid_submission" ("supplier_party_id","opened_at");--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ADD CONSTRAINT "bid_submission_OxIrnq28dyVn_fkey" FOREIGN KEY ("source_status_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ADD CONSTRAINT "bid_submission_j0cyPDBcEvAQ_fkey" FOREIGN KEY ("withdrawal_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ADD CONSTRAINT "bid_submission_hU12YGpu2uiW_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ADD CONSTRAINT "bid_submission_auction_revision_fkey" FOREIGN KEY ("auction_revision_id","auction_attempt_id") REFERENCES "core"."auction_revision"("auction_revision_id","auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ADD CONSTRAINT "bid_submission_supplier_account_fkey" FOREIGN KEY ("source_supplier_account_id","supplier_party_id") REFERENCES "core"."source_supplier_account"("source_supplier_account_id","supplier_party_id");