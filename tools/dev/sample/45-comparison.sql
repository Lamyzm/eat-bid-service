-- 책임: 새 상세의 비교 집단이 dev에서도 보이도록 같은 조건의 다른 기관 회차와 그 회차 요약 행을 심는다.
--
-- 이 파일이 없으면 dev의 기관 다섯 곳이 지역·하한율·낙찰 방식 조합을 서로 하나씩만 가져, 어느 기관을 열어도
-- 비교 집단이 자기 자신뿐이었다(2026-09-28 사용자 보고: "비교하는 게 하나도 안 보인다"). 규모를 둘로 나눈다.
--   9930001~9932400  서울 · 하한 87.500 · 최저가(서울대치초등학교와 같은 조건). 2,400건이라 점 상한(2천)을
--                    넘어 비교 집단이 밀도 점 구름으로 온다.
--   9932401~9932440  경기 · 하한 89.000 · 단가입찰(고양백석중학교 열린 공고 991003과 같은 조건). 40건이라
--                    개별 점으로 온다. 이 기관의 과거 회차는 최저가라 이 조건에서는 비교 집단만 보인다.
-- 비교 기관은 997001~997068이다. 서울 60곳, 경기 8곳.
--
-- 사정률은 난수가 아니라 번호에서 만든다. `dev:db reset`을 몇 번 돌려도 같은 그림이 나와야 화면 변화를 견줄 수 있다.
-- 회차 요약은 명단·낙찰 원장 없이 직접 심는다. 비교 집단은 추이·분포·이력의 재료일 뿐이고, 명단을 여는 것은
-- 이 기관의 회차(992001~)다. 집계 행을 원장 없이 두므로 lineage_status는 `unknown`이다.

insert into core.code_value (code_value_id, code_scheme_id, code)
overriding system value
select 997100 + n, scheme.code_scheme_id, 'DEV-CMP-ORG-' || lpad(n::text, 3, '0')
  from generate_series(1, 68) as n
  join core.code_scheme scheme on scheme.namespace = 'eat:organization';

insert into core.organization (organization_id, type, canonical_name, created_at)
overriding system value
select 997000 + n,
       case when n % 4 = 0 then 'kindergarten' else 'school' end,
       null,
       now() - interval '3 hours'
  from generate_series(1, 68) as n;

insert into core.organization_identifier (organization_id, code_value_id, observation_id)
select 997000 + n, 997100 + n, 990004
  from generate_series(1, 68) as n;

-- 이름은 관측 라벨로 붙인다. 화면은 canonical_name이 아니라 이 라벨을 읽는다(EAT-278).
insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
select 997100 + n,
       case when n <= 60 then '서울' else '경기' end
         || (array['한빛', '새솔', '푸른', '다온', '늘봄', '하람', '가온', '누리'])[1 + (n % 8)]
         || case when n % 4 = 0 then '유치원' else '초등학교' end
         || ' ' || lpad(n::text, 2, '0'),
       'ko', now() - interval '3 hours', 990004
  from generate_series(1, 68) as n;

insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
overriding system value
select 9930000 + n, 'eat', 'DEV-CMP-' || lpad(n::text, 5, '0')
  from generate_series(1, 2440) as n;

insert into ingest.normalized_record
  (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
   parser_version, normalized_at)
overriding system value
select 9930000 + n, 990003, 'auction.v5', 'DEV-CMP-' || lpad(n::text, 5, '0'),
       jsonb_build_object('source', 'dev-sample-comparison'), 'eat-v5', now() - interval '2 hours'
  from generate_series(1, 2440) as n;

/*
 * 한 회차의 규칙이다. 개찰일은 지난 1년에 흩고, 사정률은 하한 위 0.6~2.8%p에 몰리게 두 값을 더한다
 * (두 균등값의 합은 가운데가 두꺼워 실제 낙찰 분포처럼 보인다). 계절 흔들림을 조금 더해 추이가 평평하지 않게 한다.
 */
create temporary table dev_comparison_round as
select
  n,
  9930000 + n as attempt_id,
  case when n <= 2400 then 997000 + 1 + (n % 60) else 997060 + 1 + (n % 8) end as organization_id,
  case when n <= 2400 then 990102 else 990103 end as sido_id,
  case when n <= 2400 then 990113 else 990114 end as sigungu_id,
  case when n <= 2400 then 87.500 else 89.000 end::numeric as floor_rate,
  (array['육류 , 가금류', '농산물', '수산물 , 가공식품', '김치류', '곡류 , 우유류'])[1 + (n % 5)] as item_label,
  1500000::numeric + (n % 97) * 53000 as base_amount,
  date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    - ((n * 37) % 360 + 1) * interval '1 day' + interval '5 hours' as opened_at,
  round(
    (case when n <= 2400 then 87.500 else 89.000 end)
      + 0.6
      + 1.1 * (((n * 7919) % 1000) / 1000.0 + ((n * 104729) % 997) / 997.0)
      + (0.35 * sin(((n * 37) % 360) / 58.0))::numeric,
    3) as awarded_rate
  from generate_series(1, 2440) as n;

insert into core.auction_revision
  (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
   content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
   opened_at, base_amount, planned_amount, floor_rate, currency, roster_submission_count,
   lineage_observed)
overriding system value
select cmp.attempt_id, cmp.attempt_id, cmp.attempt_id, 990003,
       lpad(to_hex(cmp.attempt_id), 64, '0'),
       'DEV-CMP-' || lpad(cmp.n::text, 5, '0'),
       '낙찰',
       '비교 기관 ' || cmp.item_label || ' 구매',
       cmp.opened_at - interval '5 days',
       cmp.opened_at - interval '3 hours',
       cmp.opened_at,
       cmp.base_amount,
       round(cmp.base_amount * 0.99, 2),
       cmp.floor_rate,
       'KRW',
       null,
       false
  from dev_comparison_round cmp;

insert into core.auction_organization (auction_revision_id, organization_id, role)
select cmp.attempt_id, cmp.organization_id, 'purchaser'
  from dev_comparison_round cmp;

insert into mart.org_round_summary
  (build_id, auction_attempt_id, auction_revision_id, organization_id, item_label,
   announced_at, opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount,
   currency, awarded_assessment_rate, runner_up_assessment_rate, day_floor_amount,
   day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count, withdrawn_count,
   withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
   lineage_status, opened_month_kst,
   region_sido_code_value_id, region_sigungu_code_value_id)
select 995003, cmp.attempt_id, cmp.attempt_id, cmp.organization_id, cmp.item_label,
       cmp.opened_at - interval '5 days', cmp.opened_at, cmp.floor_rate,
       case when cmp.n <= 2400 then 990144 else 990145 end,
       cmp.base_amount, round(cmp.base_amount * 0.99, 2), 'KRW',
       cmp.awarded_rate, cmp.awarded_rate + 0.05, null, null, null,
       3 + (cmp.n % 9), null, null,
       extract(day from now() - cmp.opened_at)::integer, null, null,
       'unknown', date_trunc('month', cmp.opened_at at time zone 'Asia/Seoul')::date,
       cmp.sido_id, cmp.sigungu_id
  from dev_comparison_round cmp;

-- 품목 조건으로 거를 때도 비교 집단이 남도록 품목 다리 행을 같은 규칙으로 만든다(40-mart.sql과 같다).
insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
select summary.build_id, summary.auction_attempt_id, atom.code_value_id
  from mart.org_round_summary summary
  cross join lateral unnest(string_to_array(summary.item_label, ',')) as part
  join core.code_value atom on atom.code = btrim(part)
  join core.code_scheme scheme
    on scheme.code_scheme_id = atom.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
 where summary.build_id = 995003 and summary.auction_attempt_id between 9930001 and 9932440;

drop table dev_comparison_round;
