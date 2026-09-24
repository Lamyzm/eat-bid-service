-- 책임: 개발 표본 자료의 공고 시도·해석(revision)·구매기관 관계·조건 코드를 심는다.
-- 투찰 결과는 grain이 달라 `35-bidding.sql`이 갖는다.
--
-- 값은 손으로 나열하지 않고 시도 번호에서 규칙으로 만든다. 그래야 `dev:db reset`이 몇 번을 돌아도
-- 같은 행 수와 같은 분포가 나오고, 표본을 늘릴 때 사람이 행을 베껴 쓰다 제약을 어기지 않는다.
--
-- 번호 대역이 곧 갈래다.
--   991001~991060  열린 공고(마감이 아직 오지 않았거나 마감을 관측하지 못한 시도)
--   992001~992040  이미 개찰한 과거 회차(기관 추이와 명단의 재료)
-- 시도 번호에서 `o := id - 991000`, `p := id - 992000`을 되계산해 같은 규칙을 다시 읽는다.

insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
overriding system value
select 991000 + o, 'eat', 'DEV-OPEN-' || lpad(o::text, 4, '0')
  from generate_series(1, 60) as o
union all
select 992000 + p, 'eat', 'DEV-PAST-' || lpad(p::text, 4, '0')
  from generate_series(1, 40) as p;

-- 상세를 아직 따지 않은 공고는 정규화 기록도 해석도 없다. 목록에만 있는 시도는 유효한 상태다(ADR 0033).
insert into ingest.normalized_record
  (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
   parser_version, normalized_at)
overriding system value
select attempt.auction_attempt_id, 990003, 'auction.v5', attempt.external_bid_id,
       jsonb_build_object('source', 'dev-sample'), 'eat-v5', now() - interval '2 hours'
  from core.auction_attempt attempt
 where attempt.auction_attempt_id between 992001 and 992040
    or (attempt.auction_attempt_id between 991001 and 991060
        and (attempt.auction_attempt_id - 991000) % 12 <> 0);

/*
 * 열린 공고의 해석이다. 규칙은 다음과 같고 화면이 내야 하는 상태를 번호로 나눠 갖는다.
 *   기관       : 1 + (o % 6). 여섯째 기관은 이름도 지역도 관측하지 못한 기관이다.
 *   하한율     : 여섯 값을 돌린다. 코호트가 하나로 뭉치면 `이 값이면 몇 등`이 시험되지 않는다.
 *   마감       : o % 20 = 0이면 미관측(null), o % 17 = 0이면 이미 지난 시각, 나머지는 오늘부터 이레.
 *   품목 라벨  : 여섯째는 null이다. 품목 미상은 라벨 없음과 같은 취급이다(AGENTS 3).
 *   상태 라벨  : o % 19 = 0이면 공고취소다. 취소는 목록에서 빠지지만 자료에는 남는다(EAT-203).
 * 마감 기준시각을 KST 자정 + 23시간에 두는 이유: 심는 시각이 언제든 `오늘 마감`이 미래로 남는다.
 */
insert into core.auction_revision
  (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
   content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
   opened_at, base_amount, planned_amount, floor_rate, currency, source_payload)
overriding system value
select
  record.normalized_record_id,
  record.normalized_record_id,
  record.normalized_record_id,
  990003,
  lpad(to_hex(record.normalized_record_id), 64, '0'),
  'DEV-' || to_char(now(), 'YYYY') || '-' || lpad(spec.o::text, 4, '0'),
  -- 운영 source_status는 코드가 아니라 원천 한글 라벨이다. 영문 코드를 심으면 화면이 운영과 다른 분기를 탄다(EAT-279).
  case when spec.o % 19 = 0 then '공고취소' else '진행중' end,
  coalesce(organization.canonical_name, '이름 미관측 기관') || ' '
    || coalesce(spec.item_label, '품목 미상') || ' 구매',
  spec.kst0 - (spec.o % 5) * interval '1 day' + interval '9 hours',
  spec.closes_at,
  case when spec.closes_at is null then null else spec.closes_at + interval '3 hours' end,
  spec.base_amount,
  null,
  spec.floor_rate,
  'KRW',
  jsonb_build_object('source', 'dev-sample', 'openIndex', spec.o)
  from ingest.normalized_record record
  join lateral (
    select
      record.normalized_record_id - 991000 as o,
      date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as kst0
  ) index_of on true
  join lateral (
    select
      index_of.o,
      index_of.kst0,
      1 + (index_of.o % 6) as org_index,
      (array[90.000, 88.000, 87.500, 89.000, 90.000, 88.500])[1 + (index_of.o % 6)] as floor_rate,
      (array['육류 , 가금류', '농산물', '수산물 , 가공식품', '김치류', '곡류 , 우유류', null])
        [1 + (index_of.o % 6)] as item_label,
      1200000::numeric + index_of.o * 137000 as base_amount,
      case
        when index_of.o % 20 = 0 then null
        when index_of.o % 17 = 0 then index_of.kst0 - interval '1 day' + interval '15 hours'
        else index_of.kst0 + interval '23 hours' + (index_of.o % 7) * interval '1 day'
      end as closes_at
  ) spec on true
  join core.organization organization on organization.organization_id = 990000 + spec.org_index
 where record.normalized_record_id between 991001 and 991060;

/*
 * 과거 회차의 해석이다. 개찰은 전부 지난 시각이고 예정가격이 있다.
 *   기관   : 1 + (p % 5). 이름 미관측 기관에는 과거 회차를 주지 않는다.
 *   개찰일 : 오늘에서 (60 - p)일 전. p가 클수록 최근이라 `마지막 회차`가 번호로 정해진다.
 *   명단   : p % 4 = 0인 열 회차는 명단을 관측하지 못했다. 명단 없음과 참여 0곳은 다른 사실이다.
 */
insert into core.auction_revision
  (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
   content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
   opened_at, base_amount, planned_amount, floor_rate, currency, source_payload)
overriding system value
select
  record.normalized_record_id,
  record.normalized_record_id,
  record.normalized_record_id,
  990003,
  lpad(to_hex(record.normalized_record_id), 64, '0'),
  'DEV-PAST-' || lpad(spec.p::text, 4, '0'),
  '낙찰',
  organization.canonical_name || ' ' || spec.item_label || ' 구매',
  spec.opened_at - interval '5 days',
  spec.opened_at - interval '3 hours',
  spec.opened_at,
  spec.base_amount,
  round(spec.base_amount * 0.99, 2),
  spec.floor_rate,
  'KRW',
  case
    when spec.roster_size = 0 then jsonb_build_object('source', 'dev-sample', 'pastIndex', spec.p)
    else jsonb_build_object(
      'source', 'dev-sample',
      'pastIndex', spec.p,
      'roster', jsonb_build_object(
        'submissions',
        (select jsonb_agg(jsonb_build_object('ordinal', ordinal))
           from generate_series(1, spec.roster_size) as ordinal)))
  end
  from ingest.normalized_record record
  join lateral (
    select
      record.normalized_record_id - 992000 as p,
      date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as kst0
  ) index_of on true
  join lateral (
    select
      index_of.p,
      1 + (index_of.p % 5) as org_index,
      (array[90.000, 88.000, 87.500, 89.000, 90.000])[1 + (index_of.p % 5)] as floor_rate,
      (array['육류 , 가금류', '농산물', '수산물 , 가공식품', '김치류', '곡류 , 우유류'])
        [1 + (index_of.p % 5)] as item_label,
      2400000::numeric + index_of.p * 211000 as base_amount,
      index_of.kst0 - (60 - index_of.p) * interval '1 day' + interval '5 hours' as opened_at,
      case when index_of.p % 4 = 0 then 0 else 3 + (index_of.p % 6) end as roster_size
  ) spec on true
  join core.organization organization on organization.organization_id = 990000 + spec.org_index
 where record.normalized_record_id between 992001 and 992040;

insert into core.auction_organization (auction_revision_id, organization_id, role)
select revision.auction_revision_id, 990000 + spec.org_index, 'purchaser'
  from core.auction_revision revision
  join lateral (
    select case
      when revision.auction_attempt_id between 991001 and 991060
        then 1 + ((revision.auction_attempt_id - 991000) % 6)
      else 1 + ((revision.auction_attempt_id - 992000) % 5)
    end as org_index
  ) spec on true
 where revision.auction_attempt_id between 991001 and 992040;

-- 공고지역 축이다. 여섯째 기관의 공고에는 지역 관측이 없어 행이 서지 않는다.
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, region.sido_id, 'location_sido'
  from core.auction_revision revision
  join lateral (
    select case
      when revision.auction_attempt_id between 991001 and 991060
        then 1 + ((revision.auction_attempt_id - 991000) % 6)
      else 1 + ((revision.auction_attempt_id - 992000) % 5)
    end as org_index
  ) spec on true
  join lateral (
    select (array[990101, 990101, 990102, 990103, 990103, null])[spec.org_index]::bigint as sido_id,
           (array[990111, 990112, 990113, 990114, 990115, null])[spec.org_index]::bigint as sigungu_id
  ) region on true
 where revision.auction_attempt_id between 991001 and 992040
   and region.sido_id is not null;

insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, region.sigungu_id, 'location_sigungu'
  from core.auction_revision revision
  join lateral (
    select case
      when revision.auction_attempt_id between 991001 and 991060
        then 1 + ((revision.auction_attempt_id - 991000) % 6)
      else 1 + ((revision.auction_attempt_id - 992000) % 5)
    end as org_index
  ) spec on true
  join lateral (
    select (array[990111, 990112, 990113, 990114, 990115, null])[spec.org_index]::bigint as sigungu_id
  ) region on true
 where revision.auction_attempt_id between 991001 and 992040
   and region.sigungu_id is not null;

-- 참가제한지역은 공고지역과 다른 체계다. 여섯째 기관의 공고는 이 축도 미관측이다(AGENTS 6).
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, area.code_value_id, 'eligibility_area'
  from core.auction_revision revision
  join lateral (
    select case
      when revision.auction_attempt_id between 991001 and 991060
        then 1 + ((revision.auction_attempt_id - 991000) % 6)
      else 1 + ((revision.auction_attempt_id - 992000) % 5)
    end as org_index
  ) spec on true
  join lateral (
    select (array[990121, 990121, 990123, 990124, 990124, null])[spec.org_index]::bigint
      as code_value_id
  ) area on true
 where revision.auction_attempt_id between 991001 and 992040
   and area.code_value_id is not null;

-- 첫째 기관의 공고만 시도 전체와 시군구를 함께 관측했다. 하나를 빼면 결과가 갈리는 선택이라
-- 두 코드가 한 공고에 같이 서는 경우가 표본에 있어야 한다(ADR 0048 결정 2).
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, 990122, 'eligibility_area'
  from core.auction_revision revision
 where (revision.auction_attempt_id between 991001 and 991060
        and (revision.auction_attempt_id - 991000) % 6 = 0)
    or (revision.auction_attempt_id between 992001 and 992040
        and (revision.auction_attempt_id - 992000) % 5 = 0);

-- 낙찰 방법·예정가격 방법·단독입찰 처리·게시 종류. 전부 소스가 준 외부 코드이므로 열이 아니라 관계다.
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id,
       case when revision.auction_attempt_id % 13 = 0 then 990145 else 990144 end,
       'award_method'
  from core.auction_revision revision
 where revision.auction_attempt_id between 991001 and 992040;

insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, 990146, 'planned_price_method'
  from core.auction_revision revision
 where revision.auction_attempt_id between 991001 and 992040;

-- 단독입찰 허용안함이면 참여 0곳은 기회가 아니라 유찰이다. 두 값이 다 있어야 그 차이가 시험된다.
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id,
       case when revision.auction_attempt_id % 2 = 0 then 990147 else 990148 end,
       'solo_bid_method'
  from core.auction_revision revision
 where revision.auction_attempt_id between 991001 and 992040;

insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id,
       case when (revision.auction_attempt_id - 991000) % 11 = 0 then 990150 else 990149 end,
       'announcement_change_kind'
  from core.auction_revision revision
 where revision.auction_attempt_id between 991001 and 991060;

insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select revision.auction_revision_id, 990149, 'announcement_change_kind'
  from core.auction_revision revision
 where revision.auction_attempt_id between 992001 and 992040;

-- 품목 원자다. 라벨 한 문자열이 원자 여러 행으로 투영되며 어휘 밖 낱말은 행을 만들지 않는다.
insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
select distinct revision.auction_revision_id, atom.code_value_id, 'item'
  from core.auction_revision revision
  cross join lateral unnest(string_to_array(revision.title, ' ')) as word
  join core.code_value atom on atom.code = btrim(word)
  join core.code_scheme scheme
    on scheme.code_scheme_id = atom.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
 where revision.auction_attempt_id between 991001 and 992040;
