CREATE TABLE "core"."auction_attempt_link" (
	"auction_attempt_link_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."auction_attempt_link_auction_attempt_link_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_revision_id" bigint NOT NULL,
	"from_auction_attempt_id" bigint NOT NULL,
	"to_auction_attempt_id" bigint NOT NULL,
	"relation" varchar(32) NOT NULL,
	"display_bid_no" text,
	"source_status_code_value_id" bigint,
	"bid_opened_from" timestamp with time zone,
	"bid_closed_at" timestamp with time zone,
	"base_amount" numeric(18,2),
	"planned_amount" numeric(18,2),
	"currency" char(3),
	"observation_id" bigint NOT NULL,
	CONSTRAINT "auction_attempt_link_observation_key" UNIQUE("auction_revision_id","to_auction_attempt_id","relation"),
	CONSTRAINT "auction_attempt_link_relation_allowed" CHECK ("relation" in ('parent', 'chain_member')),
	CONSTRAINT "auction_attempt_link_currency_required_with_amount" CHECK (("base_amount" is null and "planned_amount" is null) or "currency" is not null)
);
--> statement-breakpoint
CREATE TABLE "core"."award_decision" (
	"award_decision_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."award_decision_award_decision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_revision_id" bigint NOT NULL CONSTRAINT "award_decision_auction_revision_key" UNIQUE,
	"auction_attempt_id" bigint NOT NULL,
	"awarded_roster_ordinal" integer NOT NULL,
	"source_supplier_account_id" bigint NOT NULL,
	"supplier_party_id" bigint NOT NULL,
	"awarded_at" timestamp with time zone,
	"awarded_amount" numeric(18,2) NOT NULL,
	"currency" char(3) NOT NULL,
	"awarded_rate" numeric(15,3) NOT NULL,
	"runner_up_rate" numeric(15,3),
	"source_status_code_value_id" bigint NOT NULL,
	"observation_id" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_4hmjQVgCn5SM_fkey" FOREIGN KEY ("auction_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_k02aKHd5O9AH_fkey" FOREIGN KEY ("from_auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_sNoZ0Tbubaue_fkey" FOREIGN KEY ("to_auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_d9vNMJ0QJejX_fkey" FOREIGN KEY ("source_status_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_aEh0s5y4wfVY_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."award_decision" ADD CONSTRAINT "award_decision_OxFYuEC3zTZ1_fkey" FOREIGN KEY ("source_status_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."award_decision" ADD CONSTRAINT "award_decision_hTYA5UZpoPmA_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."award_decision" ADD CONSTRAINT "award_decision_auction_revision_fkey" FOREIGN KEY ("auction_revision_id","auction_attempt_id") REFERENCES "core"."auction_revision"("auction_revision_id","auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."award_decision" ADD CONSTRAINT "award_decision_supplier_account_fkey" FOREIGN KEY ("source_supplier_account_id","supplier_party_id") REFERENCES "core"."source_supplier_account"("source_supplier_account_id","supplier_party_id");