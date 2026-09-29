CREATE TABLE "mart"."build_exclusion_month" (
	"build_id" bigint,
	"month_kst" date,
	"excluded_auction_count" bigint NOT NULL,
	"unresolved_auction_count" bigint NOT NULL,
	CONSTRAINT "build_exclusion_month_pkey" PRIMARY KEY("build_id","month_kst"),
	CONSTRAINT "mart_build_exclusion_month_excluded_positive" CHECK ("excluded_auction_count" > 0),
	CONSTRAINT "mart_build_exclusion_month_unresolved_within_excluded" CHECK ("unresolved_auction_count" >= 0 and "unresolved_auction_count" <= "excluded_auction_count")
);
--> statement-breakpoint
CREATE TABLE "mart"."build_stale_auction" (
	"build_id" bigint,
	"auction_attempt_id" bigint,
	"auction_revision_id" bigint NOT NULL,
	"excluded_observed_at" timestamp with time zone NOT NULL,
	"reflected_observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "build_stale_auction_pkey" PRIMARY KEY("build_id","auction_attempt_id"),
	CONSTRAINT "mart_build_stale_auction_excluded_after_reflected" CHECK ("excluded_observed_at" > "reflected_observed_at")
);
--> statement-breakpoint
ALTER TABLE "mart"."build_exclusion_month" ADD CONSTRAINT "build_exclusion_month_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."build_stale_auction" ADD CONSTRAINT "build_stale_auction_build_id_build_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mart"."build"("build_id");--> statement-breakpoint
ALTER TABLE "mart"."build_stale_auction" ADD CONSTRAINT "build_stale_auction_d7dNKptBuBN2_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "mart"."build_stale_auction" ADD CONSTRAINT "build_stale_auction_b8Ha83ZJEEh6_fkey" FOREIGN KEY ("auction_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
CREATE TRIGGER "build_exclusion_month_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."build_exclusion_month"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();
--> statement-breakpoint
CREATE TRIGGER "build_stale_auction_build_is_building"
BEFORE INSERT OR UPDATE OR DELETE ON "mart"."build_stale_auction"
FOR EACH ROW
EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"();
