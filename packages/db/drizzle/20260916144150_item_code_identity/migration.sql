CREATE TABLE "mart"."open_auction_snapshot_item" (
	"open_auction_snapshot_id" bigint,
	"item_code_value_id" bigint,
	CONSTRAINT "open_auction_snapshot_item_pkey" PRIMARY KEY("open_auction_snapshot_id","item_code_value_id")
);
--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" DROP CONSTRAINT "workspace_filter_combination_item_label_present";--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" ADD COLUMN "item_code_value_id" bigint;--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" ADD PRIMARY KEY ("filter_combination_id","item_code_value_id");--> statement-breakpoint
CREATE INDEX "open_auction_snapshot_item_code_idx" ON "mart"."open_auction_snapshot_item" ("item_code_value_id","open_auction_snapshot_id");--> statement-breakpoint
ALTER TABLE "app"."workspace_filter_combination_item" ADD CONSTRAINT "workspace_filter_combination_item_sq6AvoGTacB0_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot_item" ADD CONSTRAINT "open_auction_snapshot_item_pne9VIAC9Mzb_fkey" FOREIGN KEY ("open_auction_snapshot_id") REFERENCES "mart"."open_auction_snapshot"("open_auction_snapshot_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mart"."open_auction_snapshot_item" ADD CONSTRAINT "open_auction_snapshot_item_HO5SyOWn3sFh_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");