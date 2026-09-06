ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "floor_rate" numeric(6,3);--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "region_sido_code_value_id" bigint;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "region_sigungu_code_value_id" bigint;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "organization_label" text;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD COLUMN "terms_revision_id" bigint;--> statement-breakpoint
CREATE INDEX "open_auction_snapshot_build_region_sido_idx" ON "mart"."open_auction_snapshot" ("build_id","region_sido_code_value_id");--> statement-breakpoint
CREATE INDEX "open_auction_snapshot_build_item_label_idx" ON "mart"."open_auction_snapshot" ("build_id","item_label");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_Wyx43gIjRZaY_fkey" FOREIGN KEY ("region_sido_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_HP8fQgNUipVl_fkey" FOREIGN KEY ("region_sigungu_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_eFSU23AEY2sB_fkey" FOREIGN KEY ("terms_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot" ADD CONSTRAINT "open_auction_snapshot_terms_lineage_required" CHECK ("terms_revision_id" is not null
        or ("floor_rate" is null and "item_label" is null
          and "region_sido_code_value_id" is null
          and "region_sigungu_code_value_id" is null));