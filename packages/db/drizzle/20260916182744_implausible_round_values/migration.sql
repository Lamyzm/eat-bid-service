ALTER TABLE "mart"."org_round_summary" ADD COLUMN "quarantine_reason" varchar(32);--> statement-breakpoint
-- EAT-199: planned_amount 0 is "never drawn", not an amount. The observation stays in raw/normalized/source_payload;
-- the core column becomes null before the check below rejects zero (2026-09-17 restore: 79,686 revisions, 0 links).
UPDATE "core"."auction_revision" SET "planned_amount" = NULL WHERE "planned_amount" = 0;--> statement-breakpoint
UPDATE "core"."auction_attempt_link" SET "planned_amount" = NULL WHERE "planned_amount" = 0;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_planned_amount_positive" CHECK ("planned_amount" is null or "planned_amount" > 0);--> statement-breakpoint
ALTER TABLE "core"."auction_attempt_link" ADD CONSTRAINT "auction_attempt_link_planned_amount_positive" CHECK ("planned_amount" is null or "planned_amount" > 0);--> statement-breakpoint
ALTER TABLE "mart"."org_round_summary" ADD CONSTRAINT "org_round_summary_quarantine_reason_allowed" CHECK ("quarantine_reason" is null or "quarantine_reason" in ('opening-gap-over-45-days'));