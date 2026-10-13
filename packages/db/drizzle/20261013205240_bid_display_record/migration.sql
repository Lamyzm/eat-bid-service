CREATE TABLE "app"."bid_display_record" (
	"bid_display_record_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."bid_display_record_bid_display_record_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"auction_attempt_id" bigint NOT NULL,
	"method" varchar(32) NOT NULL,
	"method_version" varchar(32) NOT NULL,
	"floor_rate" numeric(6,3) NOT NULL,
	"first_base_relative_rate" numeric(8,4) NOT NULL,
	"second_base_relative_rate" numeric(8,4),
	"single_base_relative_rate" numeric(8,4),
	"basis_period" varchar(32),
	"basis_observed_through" timestamp with time zone,
	"basis_count" integer,
	"first_served_at" timestamp with time zone NOT NULL,
	"last_served_at" timestamp with time zone NOT NULL,
	"served_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bid_display_record_shown_value_key" UNIQUE NULLS NOT DISTINCT("workspace_id","auction_attempt_id","method","method_version","floor_rate","first_base_relative_rate","second_base_relative_rate","single_base_relative_rate"),
	CONSTRAINT "bid_display_record_method_known" CHECK ("method" in ('market-pick', 'national-rule', 'morning-habit')),
	CONSTRAINT "bid_display_record_served_order" CHECK ("first_served_at" <= "last_served_at"),
	CONSTRAINT "bid_display_record_served_count_positive" CHECK ("served_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX "bid_display_record_workspace_served_idx" ON "app"."bid_display_record" ("workspace_id","first_served_at");--> statement-breakpoint
ALTER TABLE "app"."bid_display_record" ADD CONSTRAINT "bid_display_record_workspace_id_workspace_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");