CREATE TABLE "mart"."build_coverage" (
	"build_id" bigint NOT NULL,
	"region_code_value_id" bigint,
	"month_kst" date NOT NULL,
	"expected_count" bigint NOT NULL,
	"observed_count" bigint NOT NULL,
	"normalized_count" bigint NOT NULL,
	"quarantined_count" bigint NOT NULL,
	"coverage" varchar(16) NOT NULL,
	CONSTRAINT "mart_build_coverage_grain_key" UNIQUE NULLS NOT DISTINCT("build_id","region_code_value_id","month_kst"),
	CONSTRAINT "mart_build_coverage_value_allowed" CHECK ("coverage" in ('complete', 'partial', 'none', 'unknown')),
	CONSTRAINT "mart_build_coverage_counts_nonnegative" CHECK ("expected_count" >= 0 and "observed_count" >= 0
        and "normalized_count" >= 0 and "quarantined_count" >= 0),
	CONSTRAINT "mart_build_coverage_terminal_within_observed" CHECK ("normalized_count" + "quarantined_count" <= "observed_count")
);
--> statement-breakpoint
CREATE TABLE "mart"."win_rate_distribution_monthly" (
	"build_id" bigint NOT NULL,
	"win_rate_distribution_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mart"."win_rate_distribution_monthly_win_rate_distribution_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scope" varchar(16) NOT NULL,
	"region_code_value_id" bigint,
	"organization_id" bigint,
	"item_code_value_id" bigint,
	"floor_rate" numeric(6,3) NOT NULL,
	"award_method_code_value_id" bigint NOT NULL,
	"month_kst" date NOT NULL,
	"bin_lower" numeric(15,3) NOT NULL,
	"bin_width" numeric(15,3) NOT NULL,
	"attempt_count" bigint NOT NULL,
	CONSTRAINT "win_rate_distribution_monthly_cohort_key" UNIQUE NULLS NOT DISTINCT("build_id","scope","region_code_value_id","organization_id","item_code_value_id","floor_rate","award_method_code_value_id","month_kst","bin_lower"),
	CONSTRAINT "win_rate_distribution_monthly_scope_allowed" CHECK ("scope" in ('national', 'province', 'district', 'organization')),
	CONSTRAINT "win_rate_distribution_monthly_scope_axis_required" CHECK (("scope" = 'national' and "region_code_value_id" is null and "organization_id" is null)
        or ("scope" in ('province', 'district')
            and "region_code_value_id" is not null and "organization_id" is null)
        or ("scope" = 'organization'
            and "region_code_value_id" is null and "organization_id" is not null)),
	CONSTRAINT "win_rate_distribution_monthly_bin_width_positive" CHECK ("bin_width" > 0),
	CONSTRAINT "win_rate_distribution_monthly_attempt_count_positive" CHECK ("attempt_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "mart"."open_auction_snapshot" (
	"build_id" bigint NOT NULL,
	"open_auction_snapshot_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mart"."open_auction_snapshot_open_auction_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_attempt_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"observation_id" bigint NOT NULL,
	"organization_id" bigint,
	"bid_count" integer,
	"source_last_changed_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"opens_at" timestamp with time zone,
	"announced_at" timestamp with time zone,
	"base_amount" numeric(18,2),
	"currency" char(3),
	"item_code_value_id" bigint,
	"item_label" text,
	"source_status_code_value_id" bigint,
	CONSTRAINT "open_auction_snapshot_observation_grain_key" UNIQUE NULLS NOT DISTINCT("build_id","auction_attempt_id","observed_at"),
	CONSTRAINT "open_auction_snapshot_currency_required_with_amount" CHECK ("base_amount" is null or "currency" is not null),
	CONSTRAINT "open_auction_snapshot_bid_count_nonnegative" CHECK ("bid_count" is null or "bid_count" >= 0)
);
--> statement-breakpoint
DROP TABLE "mart"."org_round_summary";--> statement-breakpoint
CREATE TABLE "mart"."org_round_summary" (
	"build_id" bigint NOT NULL,
	"auction_attempt_id" bigint NOT NULL,
	"auction_revision_id" bigint NOT NULL,
	"organization_id" bigint NOT NULL,
	"item_code_value_id" bigint,
	"item_label" text,
	"announced_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"floor_rate" numeric(6,3),
	"award_method_code_value_id" bigint,
	"base_amount" numeric(18,2) NOT NULL,
	"planned_amount" numeric(18,2),
	"currency" char(3) NOT NULL,
	"awarded_assessment_rate" numeric(15,3),
	"runner_up_assessment_rate" numeric(15,3),
	"day_floor_amount" numeric(18,2),
	"day_floor_bid_rate" numeric(9,4),
	"awarded_bid_rate" numeric(9,4),
	"list_count" integer,
	"below_day_floor_count" integer,
	"withdrawn_count" integer,
	"withdrawal_cohort_age_days" integer,
	"winner_supplier_party_id" bigint,
	"supersedes_attempt_id" bigint,
	"lineage_status" varchar(16) NOT NULL,
	"opened_month_kst" date,
	CONSTRAINT "org_round_summary_pkey" PRIMARY KEY("build_id","auction_attempt_id"),
	CONSTRAINT "org_round_summary_lineage_status_allowed" CHECK ("lineage_status" in ('observed', 'unknown')),
	CONSTRAINT "org_round_summary_day_floor_requires_planned_amount" CHECK ("day_floor_amount" is null or ("planned_amount" is not null and "floor_rate" is not null)),
	CONSTRAINT "org_round_summary_below_day_floor_needs_floor_rate" CHECK ("below_day_floor_count" is null or "floor_rate" is not null),
	CONSTRAINT "org_round_summary_counts_nonnegative" CHECK (("list_count" is null or "list_count" >= 0)
        and ("below_day_floor_count" is null or "below_day_floor_count" >= 0)
        and ("withdrawn_count" is null or "withdrawn_count" >= 0)),
	CONSTRAINT "org_round_summary_below_day_floor_within_list" CHECK ("below_day_floor_count" is null or "list_count" is null
        or "below_day_floor_count" <= "list_count")
);
--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_auction_attempt_id_auction_attempt_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_organization_id_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_item_code_value_id_code_value_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_supersedes_attempt_id_auction_attempt_fkey" FOREIGN KEY ("supersedes_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
CREATE INDEX "org_round_summary_build_org_announced_idx" ON "mart"."org_round_summary" ("build_id","organization_id","announced_at" DESC NULLS LAST,"auction_attempt_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "org_round_summary_build_org_item_announced_idx" ON "mart"."org_round_summary" ("build_id","organization_id","item_code_value_id","announced_at" DESC NULLS LAST,"auction_attempt_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "open_auction_snapshot_build_closes_idx" ON "mart"."open_auction_snapshot" ("build_id","closes_at","auction_attempt_id");--> statement-breakpoint
CREATE INDEX "open_auction_snapshot_attempt_observed_idx" ON "mart"."open_auction_snapshot" ("auction_attempt_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "mart"."build_coverage" ADD CONSTRAINT "build_coverage_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."build_coverage" ADD CONSTRAINT "build_coverage_ju8u2opCy2yu_fkey" FOREIGN KEY ("region_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_Q6e5Fi27C7C6_fkey" FOREIGN KEY ("auction_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_rZw51Ui9ZnGa_fkey" FOREIGN KEY ("award_method_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_a6cHh7AAz1e2_fkey" FOREIGN KEY ("winner_supplier_party_id") REFERENCES "core"."supplier_party"("supplier_party_id");--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_1dq9i5Zyw2Ox_fkey" FOREIGN KEY ("region_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_6bxUyj8O4L1W_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_y3Z7F0opi3gw_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_IOdzhCJ4gXbm_fkey" FOREIGN KEY ("award_method_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_RpP6tYjy5PH7_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_LLwxUv0oO0xB_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_VvKWbUcv0qFr_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_om2fEFC6ajpf_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_UtaIyeBBTD2K_fkey" FOREIGN KEY ("source_status_code_value_id") REFERENCES "core"."code_value"("code_value_id");
--> statement-breakpoint
CREATE TRIGGER "org_round_summary_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."org_round_summary"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();
--> statement-breakpoint
CREATE TRIGGER "win_rate_distribution_monthly_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."win_rate_distribution_monthly"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();
--> statement-breakpoint
CREATE TRIGGER "open_auction_snapshot_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."open_auction_snapshot"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();
--> statement-breakpoint
CREATE TRIGGER "build_coverage_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."build_coverage"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();