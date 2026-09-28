CREATE TABLE "ingest"."publication_exclusion" (
	"publication_id" uuid,
	"observation_id" bigint,
	"normalized_record_id" bigint,
	"stage" varchar(16) NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_exclusion_pkey" PRIMARY KEY("publication_id","observation_id"),
	CONSTRAINT "publication_exclusion_stage_allowed" CHECK ("stage" in ('normalize', 'project')),
	CONSTRAINT "publication_exclusion_stage_record" CHECK ((
        "stage" = 'normalize'
        and "normalized_record_id" is null
      ) or (
        "stage" = 'project'
        and "normalized_record_id" is not null
      )),
	CONSTRAINT "publication_exclusion_reason_code_nonempty" CHECK (char_length("reason_code") > 0),
	CONSTRAINT "publication_exclusion_reason_bounded" CHECK (char_length("reason") <= 500)
);
--> statement-breakpoint
DROP VIEW "ingest"."backfill_coverage";--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD COLUMN "excluded_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD COLUMN "excluded_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest"."publication_exclusion" ADD CONSTRAINT "publication_exclusion_n9kdQjqh5Gnu_fkey" FOREIGN KEY ("publication_id") REFERENCES "ingest"."publication"("publication_id");--> statement-breakpoint
ALTER TABLE "ingest"."publication_exclusion" ADD CONSTRAINT "publication_exclusion_chZb97YuC6FV_fkey" FOREIGN KEY ("observation_id") REFERENCES "ingest"."raw_observation"("observation_id");--> statement-breakpoint
ALTER TABLE "ingest"."publication_exclusion" ADD CONSTRAINT "publication_exclusion_uat3f1MuVR9h_fkey" FOREIGN KEY ("normalized_record_id") REFERENCES "ingest"."normalized_record"("normalized_record_id");--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD CONSTRAINT "run_excluded_count_nonnegative" CHECK ("excluded_count" >= 0);--> statement-breakpoint
ALTER TABLE "ingest"."publication" ADD CONSTRAINT "publication_excluded_count_nonnegative" CHECK ("excluded_count" >= 0);--> statement-breakpoint
ALTER TABLE "ingest"."run" DROP CONSTRAINT "run_published_count_matches_expected", ADD CONSTRAINT "run_published_count_matches_expected" CHECK ((
        "status" = 'published'
        and "published_count" + "excluded_count" = "expected_count"
      ) or (
        "status" <> 'published'
        and "published_count" = 0
      ));--> statement-breakpoint
ALTER TABLE "ingest"."publication" DROP CONSTRAINT "publication_published_requires_gate", ADD CONSTRAINT "publication_published_requires_gate" CHECK ("status" <> 'published' or (
        "validated_at" is not null
        and "activated_at" is not null
        and "expected_count" = "published_count" + "excluded_count"
        and "normalized_count" >= "published_count"
        and "normalized_count" <= "expected_count"
        and "canonical_fingerprint" is not null
        and "projector_version" is not null
      ));--> statement-breakpoint
CREATE VIEW "ingest"."backfill_coverage" AS (
    with window_release as (
      select distinct
             (u.request_params ->> 'P_BID_BGNG_DT') as window_start,
             (u.request_params ->> 'P_BID_END_DT')  as window_end,
             sr.source_release_id
        from ingest.request_unit u
        join ingest.source_release_run sr on sr.run_id = u.run_id
       where u.endpoint = 'bid-list'
         and u.request_params ? 'P_BID_BGNG_DT'
         and u.request_params ? 'P_BID_END_DT'
    ),
    failed_publication as (
      select w.window_start,
             w.window_end,
             count(distinct p.publication_id) as failed_publications
        from window_release w
        join ingest.source_release_run sr on sr.source_release_id = w.source_release_id
        join ingest.publication p on p.run_id = sr.run_id and p.status = 'failed'
       group by w.window_start, w.window_end
    ),
    excluded_observation as (
      select x.observation_id,
             bool_or(rev.auction_revision_id is not null) as resolved
        from (
          select distinct e.observation_id
            from ingest.publication_exclusion e
            join ingest.publication p on p.publication_id = e.publication_id and p.status = 'published'
        ) x
        left join ingest.normalized_record nr on nr.observation_id = x.observation_id
        left join core.auction_revision rev on rev.normalized_record_id = nr.normalized_record_id
       group by x.observation_id
    ),
    detail as (
      select w.window_start,
             w.window_end,
             (u.request_params ->> 'ELCTRN_BID_ID') as external_bid_id,
             u.status,
             nr.normalized_record_id,
             rev.auction_revision_id,
             xo.observation_id as excluded_observation_id,
             xo.resolved as exclusion_resolved
        from window_release w
        join ingest.source_release_run sr on sr.source_release_id = w.source_release_id
        join ingest.request_unit u on u.run_id = sr.run_id and u.endpoint = 'bid-detail'
        left join ingest.raw_observation o on o.request_unit_id = u.request_unit_id
        left join ingest.normalized_record nr on nr.observation_id = o.observation_id
        left join core.auction_revision rev on rev.normalized_record_id = nr.normalized_record_id
        left join excluded_observation xo on xo.observation_id = o.observation_id
    ),
    rolled as (
      select window_start,
             window_end,
             external_bid_id,
             bool_or(status = 'captured') as captured,
             bool_or(normalized_record_id is not null) as normalized,
             bool_or(auction_revision_id is not null) as published,
             bool_or(excluded_observation_id is not null) as excluded,
             bool_or(excluded_observation_id is not null and not exclusion_resolved) as unresolved_exclusion
        from detail
       group by window_start, window_end, external_bid_id
    )
    select r.window_start,
           r.window_end,
           count(*) as discovered_ids,
           count(*) filter (where r.captured) as captured_ids,
           count(*) filter (where not r.captured) as uncaptured_ids,
           count(*) filter (where r.normalized) as normalized_ids,
           count(*) filter (where r.published) as published_ids,
           count(*) filter (where r.excluded) as excluded_ids,
           count(*) filter (where r.unresolved_exclusion) as unresolved_exclusions,
           count(*) filter (where r.published or r.excluded) = count(*) as is_complete,
           coalesce(max(f.failed_publications), 0) as failed_publications
      from rolled r
      left join failed_publication f
        on f.window_start = r.window_start and f.window_end = r.window_end
     group by r.window_start, r.window_end
  );