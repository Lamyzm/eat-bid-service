CREATE TABLE "core"."code_label_observation" (
	"code_label_observation_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_label_observation_code_label_observation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code_value_id" bigint NOT NULL,
	"label" text NOT NULL,
	"language" varchar(16) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"observation_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."code_mapping" (
	"code_mapping_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_mapping_code_mapping_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from_code_value_id" bigint NOT NULL,
	"to_code_value_id" bigint NOT NULL,
	"relation" varchar(32) NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"evidence_observation_id" bigint NOT NULL,
	"status" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."code_scheme" (
	"code_scheme_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_scheme_code_scheme_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"namespace" text NOT NULL CONSTRAINT "code_scheme_namespace_key" UNIQUE,
	"owner" varchar(128) NOT NULL,
	"version_policy" varchar(64) NOT NULL,
	"valid_time_policy" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."code_value" (
	"code_value_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."code_value_code_value_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code_scheme_id" bigint NOT NULL,
	"code" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "code_value_scheme_code_key" UNIQUE("code_scheme_id","code")
);
--> statement-breakpoint
CREATE TABLE "core"."organization" (
	"organization_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."organization_organization_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(64) NOT NULL,
	"canonical_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."organization_identifier" (
	"organization_identifier_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."organization_identifier_organization_identifier_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" bigint NOT NULL,
	"code_value_id" bigint NOT NULL CONSTRAINT "organization_identifier_code_value_key" UNIQUE,
	"observation_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."auction_attempt" (
	"auction_attempt_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."auction_attempt_auction_attempt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_system" varchar(64) NOT NULL,
	"external_bid_id" text NOT NULL,
	"display_bid_no" text NOT NULL,
	CONSTRAINT "auction_attempt_source_external_bid_key" UNIQUE("source_system","external_bid_id")
);
--> statement-breakpoint
CREATE TABLE "core"."auction_organization" (
	"auction_attempt_id" bigint,
	"organization_id" bigint,
	"role" varchar(32),
	CONSTRAINT "auction_organization_pkey" PRIMARY KEY("auction_attempt_id","organization_id","role")
);
--> statement-breakpoint
CREATE TABLE "core"."auction_revision" (
	"auction_revision_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."auction_revision_auction_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_attempt_id" bigint NOT NULL,
	"observation_id" bigint NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"source_status" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"announced_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"base_amount" numeric(18,2),
	"planned_amount" numeric(18,2),
	"currency" char(3),
	"source_payload" jsonb NOT NULL,
	CONSTRAINT "auction_revision_attempt_content_key" UNIQUE("auction_attempt_id","content_sha256")
);
--> statement-breakpoint
ALTER TABLE "core"."code_label_observation" ADD CONSTRAINT "code_label_observation_la4H1hXzGNup_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_label_observation" ADD CONSTRAINT "code_label_observation_T9Quh6WzLukF_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."code_mapping" ADD CONSTRAINT "code_mapping_from_code_value_id_code_value_code_value_id_fkey" FOREIGN KEY ("from_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_mapping" ADD CONSTRAINT "code_mapping_to_code_value_id_code_value_code_value_id_fkey" FOREIGN KEY ("to_code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."code_mapping" ADD CONSTRAINT "code_mapping_2cKX1iOoAuI0_fkey" FOREIGN KEY ("evidence_observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."code_value" ADD CONSTRAINT "code_value_code_scheme_id_code_scheme_code_scheme_id_fkey" FOREIGN KEY ("code_scheme_id") REFERENCES "core"."code_scheme"("code_scheme_id");--> statement-breakpoint
ALTER TABLE "core"."organization_identifier" ADD CONSTRAINT "organization_identifier_TD5SDIyrLAVD_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "core"."organization_identifier" ADD CONSTRAINT "organization_identifier_idcHuDcsZh71_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "core"."organization_identifier" ADD CONSTRAINT "organization_identifier_m13O1dlwZTMH_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "core"."auction_organization" ADD CONSTRAINT "auction_organization_5NWiiTVt9fjP_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."auction_organization" ADD CONSTRAINT "auction_organization_iKxEkTQEMUXz_fkey" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("organization_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_YX75sNYJPj5R_fkey" FOREIGN KEY ("auction_attempt_id") REFERENCES "core"."auction_attempt"("auction_attempt_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_7bISUFzqRJ9r_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");