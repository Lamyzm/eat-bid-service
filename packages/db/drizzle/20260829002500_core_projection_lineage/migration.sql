CREATE TABLE "core"."auction_revision_code_value" (
	"auction_revision_id" bigint,
	"code_value_id" bigint,
	"role" varchar(32),
	CONSTRAINT "auction_revision_code_value_pkey" PRIMARY KEY("auction_revision_id","code_value_id","role"),
	CONSTRAINT "auction_revision_code_value_role_allowed" CHECK ("role" in ('location_sido', 'location_sigungu', 'eligibility_area'))
);
--> statement-breakpoint
ALTER TABLE "core"."auction_organization" DROP CONSTRAINT "auction_organization_5NWiiTVt9fjP_fkey";--> statement-breakpoint
ALTER TABLE "core"."auction_revision" DROP CONSTRAINT "auction_revision_attempt_content_key";--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD COLUMN "canonical_fingerprint" char(64);--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD COLUMN "projector_version" varchar(128);--> statement-breakpoint
ALTER TABLE "core"."auction_organization" ADD COLUMN "auction_revision_id" bigint;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD COLUMN "normalized_record_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD COLUMN "display_bid_no" text;--> statement-breakpoint
ALTER TABLE "core"."auction_organization" DROP COLUMN "auction_attempt_id";--> statement-breakpoint
ALTER TABLE "core"."auction_attempt" DROP COLUMN "display_bid_no";--> statement-breakpoint
ALTER TABLE "core"."auction_organization" ADD PRIMARY KEY ("auction_revision_id","organization_id","role");--> statement-breakpoint
ALTER TABLE "core"."organization" ALTER COLUMN "canonical_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."code_label_observation" ADD CONSTRAINT "code_label_observation_evidence_key" UNIQUE("code_value_id","label","language","observation_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_normalized_record_key" UNIQUE("normalized_record_id");--> statement-breakpoint
ALTER TABLE "core"."auction_organization" ADD CONSTRAINT "auction_organization_p42qwxorJn1f_fkey" FOREIGN KEY ("auction_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision" ADD CONSTRAINT "auction_revision_kvTOaxDn4KoF_fkey" FOREIGN KEY ("normalized_record_id") REFERENCES "ingest"."normalized_record"("normalized_record_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision_code_value" ADD CONSTRAINT "auction_revision_code_value_orktJF5dHNCB_fkey" FOREIGN KEY ("auction_revision_id") REFERENCES "core"."auction_revision"("auction_revision_id");--> statement-breakpoint
ALTER TABLE "core"."auction_revision_code_value" ADD CONSTRAINT "auction_revision_code_value_NpfuycI19Tc7_fkey" FOREIGN KEY ("code_value_id") REFERENCES "core"."code_value"("code_value_id");--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD CONSTRAINT "run_end_chronology" CHECK ("ended_at" is null or "ended_at" >= "started_at");--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD CONSTRAINT "run_terminal_metadata" CHECK ((
        "status" = 'failed'
        and "failure_category" is not null
        and "ended_at" is not null
      ) or (
        "status" = 'published'
        and "failure_category" is null
        and "ended_at" is not null
      ) or (
        "status" in ('planned', 'running', 'validated')
        and "failure_category" is null
        and "ended_at" is null
      ));--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD CONSTRAINT "run_published_count_matches_expected" CHECK ((
        "status" = 'published'
        and "published_count" = "expected_count"
      ) or (
        "status" <> 'published'
        and "published_count" = 0
      ));--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_activation_chronology" CHECK ("activated_at" is null or "validated_at" is null or "activated_at" >= "validated_at");--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_canonical_fingerprint_sha256" CHECK ("canonical_fingerprint" is null or "canonical_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_projector_version_nonempty" CHECK ("projector_version" is null or char_length("projector_version") > 0);--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_nonpublished_metadata_empty" CHECK ("status" = 'published' or (
        "activated_at" is null
        and "published_count" = 0
        and "canonical_fingerprint" is null
        and "projector_version" is null
      ));--> statement-breakpoint
ALTER TABLE "ingest"."publication" DROP CONSTRAINT "publication_published_requires_gate", ADD CONSTRAINT "publication_published_requires_gate" CHECK ("status" <> 'published' or (
        "validated_at" is not null
        and "activated_at" is not null
        and "expected_count" = "normalized_count"
        and "normalized_count" = "published_count"
        and "canonical_fingerprint" is not null
        and "projector_version" is not null
      ));