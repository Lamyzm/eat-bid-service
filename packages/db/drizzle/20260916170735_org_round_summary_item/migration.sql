CREATE TABLE "mart"."org_round_summary_item" (
	"build_id" bigint,
	"auction_attempt_id" bigint,
	"item_code_value_id" bigint,
	CONSTRAINT "org_round_summary_item_pkey" PRIMARY KEY("build_id","auction_attempt_id","item_code_value_id")
);
--> statement-breakpoint
DROP INDEX "mart"."org_round_summary_build_org_item_announced_idx";--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" DROP COLUMN "item_code_value_id";--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" DROP COLUMN "item_code_value_id";--> statement-breakpoint
ALTER TABLE "mart"."win_rate_distribution_monthly" ADD CONSTRAINT "win_rate_distribution_monthly_cohort_key" UNIQUE NULLS NOT DISTINCT("build_id","scope","region_code_value_id","organization_id","floor_rate","award_method_code_value_id","month_kst","bin_lower");--> statement-breakpoint
CREATE INDEX "org_round_summary_item_build_code_idx" ON "mart"."org_round_summary_item" ("build_id","item_code_value_id","auction_attempt_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary_item" ADD CONSTRAINT "org_round_summary_item_Pxhx8isipJUc_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary_item" ADD CONSTRAINT "org_round_summary_item_summary_fkey" FOREIGN KEY ("build_id","auction_attempt_id") REFERENCES "mart"."org_round_summary"("build_id","auction_attempt_id") ON DELETE CASCADE;