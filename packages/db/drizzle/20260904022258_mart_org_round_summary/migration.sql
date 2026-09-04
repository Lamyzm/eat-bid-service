CREATE TABLE "mart"."org_round_summary" (
	"auction_attempt_id" bigint PRIMARY KEY,
	"organization_id" bigint NOT NULL,
	"item_code_value_id" bigint,
	"item_label" text,
	"announced_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"floor_rate" numeric(6,3),
	"base_amount" numeric(18,2) NOT NULL,
	"currency" char(3) NOT NULL,
	"win_rate" numeric(6,3),
	"second_rate" numeric(6,3),
	"day_floor_rate" numeric(6,3),
	"list_count" integer,
	"invalid_count" integer,
	"winner_supplier_party_id" bigint,
	"supersedes_attempt_id" bigint,
	"mart_release" varchar(64) NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"calc_version" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "org_round_summary_org_announced_idx" ON "mart"."org_round_summary" ("organization_id","announced_at" DESC NULLS LAST,"auction_attempt_id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_UUASDpbYBBUW_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_nBmz2lUE0cls_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_ikplppfegVcK_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_lBkqnbMgXtrE_fkey" FOREIGN KEY ("supersedes_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");