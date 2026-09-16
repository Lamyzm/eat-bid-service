DROP VIEW "ingest"."backfill_coverage";--> statement-breakpoint
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
    detail as (
      select w.window_start,
             w.window_end,
             (u.request_params ->> 'ELCTRN_BID_ID') as external_bid_id,
             u.status,
             nr.normalized_record_id,
             rev.auction_revision_id
        from window_release w
        join ingest.source_release_run sr on sr.source_release_id = w.source_release_id
        join ingest.request_unit u on u.run_id = sr.run_id and u.endpoint = 'bid-detail'
        left join ingest.raw_observation o on o.request_unit_id = u.request_unit_id
        left join ingest.normalized_record nr on nr.observation_id = o.observation_id
        left join core.auction_revision rev on rev.normalized_record_id = nr.normalized_record_id
    ),
    rolled as (
      select window_start,
             window_end,
             external_bid_id,
             bool_or(status = 'captured') as captured,
             bool_or(normalized_record_id is not null) as normalized,
             bool_or(auction_revision_id is not null) as published
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
           count(*) filter (where r.published) = count(*) as is_complete,
           coalesce(max(f.failed_publications), 0) as failed_publications
      from rolled r
      left join failed_publication f
        on f.window_start = r.window_start and f.window_end = r.window_end
     group by r.window_start, r.window_end
  );