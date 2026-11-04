CREATE TABLE "app"."auction_amount_assignment" (
	"auction_amount_assignment_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."auction_amount_assignment_auction_amount_assignment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_attempt_id" bigint NOT NULL,
	"workspace_id" bigint NOT NULL,
	"market_seat_id" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"basis_observation_id" bigint NOT NULL,
	"rule_version" varchar(32) NOT NULL,
	"candidate_market_seat_ids" bigint[] NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"actor_principal_id" bigint,
	"reason" text,
	CONSTRAINT "auction_amount_assignment_kind_known" CHECK ("kind" in ('took', 'handed_over', 'confirmed', 'corrected')),
	CONSTRAINT "auction_amount_assignment_superseded_after_recorded" CHECK ("superseded_at" is null or "superseded_at" >= "recorded_at"),
	CONSTRAINT "auction_amount_assignment_correction_has_reason" CHECK ("kind" <> 'corrected' or ("actor_principal_id" is not null and length(btrim("reason")) > 0)),
	CONSTRAINT "auction_amount_assignment_candidate_includes_seat" CHECK ("market_seat_id" = any("candidate_market_seat_ids"))
);
--> statement-breakpoint
CREATE TABLE "app"."market_seat" (
	"market_seat_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."market_seat_market_seat_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"region_code_value_id" bigint NOT NULL,
	"item_code_value_id" bigint NOT NULL,
	"state" varchar(16) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"priority_started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_seat_state_known" CHECK ("state" in ('held', 'active', 'reclaim', 'offer')),
	CONSTRAINT "market_seat_period_order" CHECK ("starts_at" <= "ends_at"),
	CONSTRAINT "market_seat_priority_not_after_start" CHECK ("priority_started_at" <= "starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."market_seat_event" (
	"market_seat_event_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."market_seat_event_market_seat_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_seat_id" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_principal_id" bigint,
	"reason_code" varchar(32) NOT NULL,
	"memo" text,
	"previous_ends_at" timestamp with time zone,
	"next_ends_at" timestamp with time zone,
	CONSTRAINT "market_seat_event_kind_known" CHECK ("kind" in ('held', 'activated', 'extended', 'revoked', 'released', 'reclaimed', 'offered', 'corrected')),
	CONSTRAINT "market_seat_event_reason_present" CHECK (length(btrim("reason_code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."seat_business_claim" (
	"seat_business_claim_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."seat_business_claim_seat_business_claim_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"business_number" char(10) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_business_claim_number_digits" CHECK ("business_number" ~ '^[0-9]{10}$'),
	CONSTRAINT "seat_business_claim_period_order" CHECK ("starts_at" <= "ends_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auction_amount_assignment_current_key" ON "app"."auction_amount_assignment" ("auction_attempt_id") WHERE "superseded_at" is null;--> statement-breakpoint
CREATE INDEX "auction_amount_assignment_attempt_idx" ON "app"."auction_amount_assignment" ("auction_attempt_id","recorded_at");--> statement-breakpoint
CREATE INDEX "auction_amount_assignment_workspace_idx" ON "app"."auction_amount_assignment" ("workspace_id","recorded_at");--> statement-breakpoint
CREATE INDEX "market_seat_workspace_idx" ON "app"."market_seat" ("workspace_id","ends_at");--> statement-breakpoint
CREATE INDEX "market_seat_event_seat_idx" ON "app"."market_seat_event" ("market_seat_id","occurred_at");--> statement-breakpoint
CREATE INDEX "seat_business_claim_workspace_idx" ON "app"."seat_business_claim" ("workspace_id","ends_at");--> statement-breakpoint
ALTER TABLE "app"."auction_amount_assignment" ADD CONSTRAINT "auction_amount_assignment_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."auction_amount_assignment" ADD CONSTRAINT "auction_amount_assignment_market_seat_fkey" FOREIGN KEY ("market_seat_id") REFERENCES "app"."market_seat"("market_seat_id");--> statement-breakpoint
ALTER TABLE "app"."auction_amount_assignment" ADD CONSTRAINT "auction_amount_assignment_actor_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."market_seat" ADD CONSTRAINT "market_seat_workspace_id_workspace_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");--> statement-breakpoint
ALTER TABLE "app"."market_seat" ADD CONSTRAINT "market_seat_region_code_value_fkey" FOREIGN KEY ("region_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "app"."market_seat" ADD CONSTRAINT "market_seat_item_code_value_fkey" FOREIGN KEY ("item_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "app"."market_seat_event" ADD CONSTRAINT "market_seat_event_market_seat_fkey" FOREIGN KEY ("market_seat_id") REFERENCES "app"."market_seat"("market_seat_id");--> statement-breakpoint
ALTER TABLE "app"."market_seat_event" ADD CONSTRAINT "market_seat_event_actor_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "app"."principal"("principal_id");--> statement-breakpoint
ALTER TABLE "app"."seat_business_claim" ADD CONSTRAINT "seat_business_claim_workspace_id_workspace_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspace"("workspace_id");