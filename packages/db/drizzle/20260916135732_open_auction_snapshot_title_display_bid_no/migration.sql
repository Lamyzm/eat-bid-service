ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "display_bid_no" text;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" DROP CONSTRAINT "open_auction_snapshot_terms_lineage_required", ADD CONSTRAINT "open_auction_snapshot_terms_lineage_required" CHECK ("terms_revision_id" is not null
        or ("floor_rate" is null and "item_label" is null
          and "announced_at" is null
          and "title" is null and "display_bid_no" is null
          and "region_sido_code_value_id" is null
          and "region_sigungu_code_value_id" is null));