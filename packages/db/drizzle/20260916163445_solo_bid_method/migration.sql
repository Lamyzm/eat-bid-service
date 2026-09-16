ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "solo_bid_method_code_value_id" bigint;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_4wMSobVjgtBv_fkey" FOREIGN KEY ("solo_bid_method_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision_code_value" DROP CONSTRAINT "auction_revision_code_value_role_allowed", ADD CONSTRAINT "auction_revision_code_value_role_allowed" CHECK ("role" in ('location_sido', 'location_sigungu', 'eligibility_area', 'award_method', 'planned_price_method', 'solo_bid_method', 'item'));--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" DROP CONSTRAINT "open_auction_snapshot_terms_lineage_required", ADD CONSTRAINT "open_auction_snapshot_terms_lineage_required" CHECK ("terms_revision_id" is not null
        or ("floor_rate" is null and "item_label" is null
          and "announced_at" is null
          and "title" is null and "display_bid_no" is null
          and "solo_bid_method_code_value_id" is null
          and "region_sido_code_value_id" is null
          and "region_sigungu_code_value_id" is null));