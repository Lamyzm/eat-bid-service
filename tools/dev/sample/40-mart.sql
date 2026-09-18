-- 책임: 개발 표본 자료의 mart build 원장과 그 build에 매달린 열린 공고 스냅샷·회차 요약·낙찰 분포·
-- 보유율 행을 심는다.
--
-- 값을 손으로 적지 않고 core에서 집계해 만든다. 빌더가 하는 일과 같은 방향이라 명단·낙찰과 요약이
-- 서로 다른 말을 하지 않는다. 숫자를 따로 적어 두면 core를 고칠 때마다 요약이 조용히 거짓이 된다.
--
-- build 넷을 두는 이유: 열린 공고 스냅샷은 활성 하나와 물린 하나가 함께 있어야 참여 수 추이가
-- `지금`과 `하루 전`을 서로 다른 build에서 읽는 경로를 지난다(ADR 0034).

insert into mart.build
  (build_id, mart_name, source_release_id, publication_id, calc_version, builder_version,
   region_scheme, status, as_of, started_at)
overriding system value
values
  (995001, 'open_auction_snapshot', '9e000000-0000-4000-8000-000000000201',
   '9e000000-0000-4000-8000-000000000101', 'dev-sample-r2', repeat('9d', 20),
   'eat:auction-location-sigungu', 'building', now() - interval '2 hours', now() - interval '2 hours'),
  (995002, 'open_auction_snapshot', '9e000000-0000-4000-8000-000000000201',
   null, 'dev-sample-r1', repeat('9d', 20),
   'eat:auction-location-sigungu', 'building', now() - interval '1 day', now() - interval '1 day'),
  (995003, 'org_round_summary', '9e000000-0000-4000-8000-000000000201',
   '9e000000-0000-4000-8000-000000000101', 'dev-sample-r1', repeat('9d', 20),
   'eat:auction-location-sigungu', 'building', now() - interval '2 hours', now() - interval '2 hours'),
  (995004, 'win_rate_distribution_monthly', '9e000000-0000-4000-8000-000000000201',
   '9e000000-0000-4000-8000-000000000101', 'dev-sample-r1', repeat('9d', 20),
   'eat:auction-location-sigungu', 'building', now() - interval '2 hours', now() - interval '2 hours');

/*
 * 열린 공고 스냅샷이다. 상세 파생 열은 전부 `terms_revision_id` 계보를 타며, 상세를 아직 따지 않은
 * 시도(o % 12 = 0)는 그 열들이 통째로 비어 있다. 그것이 값 없음이 아니라 아직 모름이라는 뜻이다.
 * 같은 build에 관측이 둘인 시도(o % 3 = 0)를 섞어 목록이 최신 관측 하나만 고르는 경로를 지나게 한다.
 */
insert into mart.open_auction_snapshot
  (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
   source_last_changed_at, closes_at, opens_at, announced_at, base_amount, currency,
   item_code_value_id, item_label, source_status_label, floor_rate, title, display_bid_no,
   solo_bid_method_code_value_id, announcement_change_kind_code_value_id,
   region_sido_code_value_id, region_sigungu_code_value_id, organization_label, terms_revision_id)
select
  snapshot.build_id,
  attempt.auction_attempt_id,
  snapshot.observed_at,
  snapshot.observation_id,
  purchaser.organization_id,
  snapshot.bid_count,
  snapshot.observed_at - interval '2 hours',
  spec.closes_at,
  revision.opened_at,
  revision.announced_at,
  coalesce(revision.base_amount, 1200000::numeric + spec.o * 137000),
  'KRW',
  null,
  spec.item_label,
  case
    when revision.auction_revision_id is null then null
    when revision.source_status = 'CANCELLED' then '공고취소'
    else '진행중'
  end,
  revision.floor_rate,
  revision.title,
  revision.display_bid_no,
  solo_bid.code_value_id,
  change_kind.code_value_id,
  sido.code_value_id,
  sigungu.code_value_id,
  organization.canonical_name,
  revision.auction_revision_id
  from core.auction_attempt attempt
  join lateral (
    select attempt.auction_attempt_id - 991000 as o,
           date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as kst0
  ) index_of on true
  join lateral (
    select
      index_of.o,
      case when index_of.o % 12 = 0 then null else
        (array['육류 , 가금류', '농산물', '수산물 , 가공식품', '김치류', '곡류 , 우유류', null])
          [1 + (index_of.o % 6)] end as item_label,
      -- 상세를 따지 않은 시도에도 목록은 마감을 준다. 30-auctions.sql의 규칙을 그대로 되읽는다.
      case
        when index_of.o % 20 = 0 then null
        when index_of.o % 17 = 0 then index_of.kst0 - interval '1 day' + interval '15 hours'
        else index_of.kst0 + interval '23 hours' + (index_of.o % 7) * interval '1 day'
      end as closes_at
  ) spec on true
  cross join lateral (values
    (995001::bigint, now() - interval '30 minutes', 990002::bigint, index_of.o % 9, true),
    (995001::bigint, now() - interval '6 hours', 990002::bigint, greatest(index_of.o % 9 - 1, 0),
     index_of.o % 3 = 0),
    (995002::bigint, now() - interval '1 day' - interval '30 minutes', 990001::bigint,
     greatest(index_of.o % 9 - 2, 0), true)
  ) as snapshot(build_id, observed_at, observation_id, bid_count, included)
  left join core.auction_revision revision
    on revision.auction_attempt_id = attempt.auction_attempt_id
  left join core.auction_organization purchaser
    on purchaser.auction_revision_id = revision.auction_revision_id and purchaser.role = 'purchaser'
  left join core.organization organization
    on organization.organization_id = purchaser.organization_id
  left join lateral (
    select link.code_value_id from core.auction_revision_code_value link
     where link.auction_revision_id = revision.auction_revision_id and link.role = 'location_sido'
     limit 1
  ) sido on true
  left join lateral (
    select link.code_value_id from core.auction_revision_code_value link
     where link.auction_revision_id = revision.auction_revision_id and link.role = 'location_sigungu'
     limit 1
  ) sigungu on true
  left join lateral (
    select link.code_value_id from core.auction_revision_code_value link
     where link.auction_revision_id = revision.auction_revision_id and link.role = 'solo_bid_method'
     limit 1
  ) solo_bid on true
  left join lateral (
    select link.code_value_id from core.auction_revision_code_value link
     where link.auction_revision_id = revision.auction_revision_id
       and link.role = 'announcement_change_kind'
     limit 1
  ) change_kind on true
 where attempt.auction_attempt_id between 991001 and 991060
   and snapshot.included;

-- 라벨 한 문자열을 원자 여러 행으로 편다. 어휘 밖 낱말은 행을 만들지 않으므로 원자가 하나도 없는
-- 행이 `품목 미상`이 된다(AGENTS 3, EAT-230).
insert into mart.open_auction_snapshot_item (open_auction_snapshot_id, item_code_value_id)
select snapshot.open_auction_snapshot_id, atom.code_value_id
  from mart.open_auction_snapshot snapshot
  cross join lateral unnest(string_to_array(snapshot.item_label, ',')) as part
  join core.code_value atom on atom.code = btrim(part)
  join core.code_scheme scheme
    on scheme.code_scheme_id = atom.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
 where snapshot.build_id in (995001, 995002);

/*
 * 회차 요약이다. 명단·낙찰을 집계해 만들고, 관측하지 못한 자리는 0이 아니라 null로 남긴다.
 *   명단 미관측(p % 4 = 0)  : `list_count`·`below_day_floor_count`·`withdrawn_count`가 전부 null이다.
 *   낙찰 미관측             : 사정률 두 개와 낙찰 투찰률이 null이다.
 * 그날 하한 금액은 내림이다. 올림하면 유효한 투찰 하나가 없는 것이 된다(ADR 0034).
 */
insert into mart.org_round_summary
  (build_id, auction_attempt_id, auction_revision_id, organization_id, item_label,
   announced_at, opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount,
   currency, awarded_assessment_rate, runner_up_assessment_rate, day_floor_amount,
   day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count, withdrawn_count,
   withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
   lineage_status, opened_month_kst,
   region_sido_code_value_id, region_sigungu_code_value_id)
select
  995003,
  revision.auction_attempt_id,
  revision.auction_revision_id,
  purchaser.organization_id,
  spec.item_label,
  revision.announced_at,
  revision.opened_at,
  revision.floor_rate,
  award_method.code_value_id,
  revision.base_amount,
  revision.planned_amount,
  'KRW',
  award.awarded_rate,
  award.runner_up_rate,
  day_floor.amount,
  round(day_floor.amount / revision.base_amount * 100, 4),
  case when award.awarded_amount is null then null
    else round(award.awarded_amount / revision.base_amount * 100, 4) end,
  roster.list_count,
  roster.below_day_floor_count,
  roster.withdrawn_count,
  extract(day from now() - revision.opened_at)::integer,
  award.supplier_party_id,
  null,
  case when link.from_auction_attempt_id is null then 'unknown' else 'observed' end,
  date_trunc('month', revision.opened_at at time zone 'Asia/Seoul')::date,
  -- 지역은 두 열이다. 시도와 시군구가 서로 다른 code scheme이라 한 열에 담으면 같은 숫자가 어느
  -- 체계의 구역인지 말하지 않는다(AGENTS 6). 분석의 지역 비교가 이 열을 읽는다(EAT-198).
  sido.code_value_id,
  sigungu.code_value_id
  from core.auction_revision revision
  join lateral (
    select
      (array['육류 , 가금류', '농산물', '수산물 , 가공식품', '김치류', '곡류 , 우유류'])
        [1 + ((revision.auction_attempt_id - 992000) % 5)] as item_label
  ) spec on true
  join core.auction_organization purchaser
    on purchaser.auction_revision_id = revision.auction_revision_id and purchaser.role = 'purchaser'
  join lateral (
    select trunc(revision.planned_amount * revision.floor_rate / 100, 2) as amount
  ) day_floor on true
  left join lateral (
    select link.code_value_id from core.auction_revision_code_value link
     where link.auction_revision_id = revision.auction_revision_id and link.role = 'award_method'
     limit 1
  ) award_method on true
  left join lateral (
    select count(*)::integer as list_count,
           count(*) filter (where roster_row.bid_rate < revision.floor_rate)::integer
             as below_day_floor_count,
           count(*) filter (where roster_row.withdrawal_code_value_id is not null)::integer
             as withdrawn_count
      from core.bid_submission roster_row
     where roster_row.auction_revision_id = revision.auction_revision_id
    having count(*) > 0
  ) roster on true
  left join core.award_decision award
    on award.auction_revision_id = revision.auction_revision_id
  left join lateral (
    select chain.from_auction_attempt_id from core.auction_attempt_link chain
     where chain.to_auction_attempt_id = revision.auction_attempt_id
     limit 1
  ) link on true
  left join lateral (
    select code.code_value_id from core.auction_revision_code_value code
     where code.auction_revision_id = revision.auction_revision_id and code.role = 'location_sido'
     limit 1
  ) sido on true
  left join lateral (
    select code.code_value_id from core.auction_revision_code_value code
     where code.auction_revision_id = revision.auction_revision_id and code.role = 'location_sigungu'
     limit 1
  ) sigungu on true
 where revision.auction_attempt_id between 992001 and 992040;

insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
select summary.build_id, summary.auction_attempt_id, atom.code_value_id
  from mart.org_round_summary summary
  cross join lateral unnest(string_to_array(summary.item_label, ',')) as part
  join core.code_value atom on atom.code = btrim(part)
  join core.code_scheme scheme
    on scheme.code_scheme_id = atom.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
 where summary.build_id = 995003;

/*
 * 낙찰 사정률 분포다. 전국과 기관 두 모집단이 같은 회차를 각각 한 번씩 세므로 두 scope의 합은
 * 회차 수가 아니다. 구간은 반개구간 `[bin_lower, bin_lower + 0.100)`이다.
 */
insert into mart.win_rate_distribution_monthly
  (build_id, scope, region_code_value_id, organization_id, floor_rate,
   award_method_code_value_id, month_kst, bin_lower, bin_width, attempt_count)
select 995004, 'national', null::bigint, null::bigint, summary.floor_rate,
       summary.award_method_code_value_id,
       summary.opened_month_kst, floor(summary.awarded_assessment_rate * 10) / 10, 0.100,
       count(*)
  from mart.org_round_summary summary
 where summary.build_id = 995003
   and summary.awarded_assessment_rate is not null
   and summary.award_method_code_value_id is not null
 group by summary.floor_rate, summary.award_method_code_value_id, summary.opened_month_kst,
          floor(summary.awarded_assessment_rate * 10) / 10
union all
select 995004, 'organization', null::bigint, summary.organization_id, summary.floor_rate,
       summary.award_method_code_value_id, summary.opened_month_kst,
       floor(summary.awarded_assessment_rate * 10) / 10, 0.100, count(*)
  from mart.org_round_summary summary
 where summary.build_id = 995003
   and summary.awarded_assessment_rate is not null
   and summary.award_method_code_value_id is not null
 group by summary.organization_id, summary.floor_rate, summary.award_method_code_value_id,
          summary.opened_month_kst, floor(summary.awarded_assessment_rate * 10) / 10;

-- 보유율이다. 이 표본은 전국 축 없이 심었으므로 지역 grain의 분모를 낼 수 없고, 그 사실을
-- `partial`로 뭉개지 않고 `unknown`으로 남긴다(AGENTS 3).
insert into mart.build_coverage
  (build_id, region_code_value_id, month_kst, expected_count, observed_count,
   normalized_count, quarantined_count, coverage)
select build.build_id, null::bigint,
       date_trunc('month', now() at time zone 'Asia/Seoul')::date,
       60, 60, 55, 0,
       'partial'
  from mart.build build
 where build.build_id in (995001, 995003)
union all
select 995003, null::bigint,
       (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::date,
       40, 40, 40, 0, 'unknown';

-- 상태 전이를 마지막에 한다. 행 수를 세고 나서야 `검증했다`고 말할 수 있고, 활성 build는 mart마다
-- 하나뿐이라 물린 build의 전이도 여기서 함께 닫는다.
update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.open_auction_snapshot snapshot
                     where snapshot.build_id = mart.build.build_id)
 where build_id in (995001, 995002);

update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.org_round_summary summary
                     where summary.build_id = mart.build.build_id)
 where build_id = 995003;

update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.win_rate_distribution_monthly distribution
                     where distribution.build_id = mart.build.build_id)
 where build_id = 995004;

update mart.build
   set status = 'active', activated_at = computed_at + interval '1 minute'
 where build_id in (995002);

update mart.build
   set status = 'superseded',
       superseded_at = now() - interval '2 hours',
       retain_until = now() + interval '7 days'
 where build_id = 995002;

update mart.build
   set status = 'active', activated_at = computed_at + interval '1 minute'
 where build_id in (995001, 995003, 995004);
