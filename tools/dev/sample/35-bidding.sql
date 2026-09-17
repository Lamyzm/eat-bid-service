-- 책임: 개발 표본 자료의 투찰 명단·낙찰 판정·재입찰 사슬을 심는다.
--
-- 공고 해석(`30-auctions.sql`)과 나누는 자리는 core schema가 나눈 자리와 같다. 공고 관측 grain과
-- 투찰 결과 grain은 관측 시점도 재실행 단위도 달라 함께 바뀌지 않는다
-- (`packages/db/src/schema/core/bidding.ts`).
--
-- 번호 규칙은 앞 파일과 같다. 과거 회차는 992001~992040이고 `p := id - 992000`이다.

/*
 * 투찰 명단이다. 명단 행의 관측은 해석과 같은 관측이어야 한다(`내 투찰`의 완전성 근거가 그 짝을 센다).
 * 사업자 990001은 개발 로그인 워크스페이스가 등록하는 업체이며, 좌표 하나 걸러 한 번씩 명단에 선다.
 * 사정률은 하한 언저리에서 흩뿌려 그날 하한 아래 행이 섞이게 한다 — 전부 하한 위면 `아래 몇 곳`이
 * 언제나 0이라 화면의 그 칸이 시험되지 않는다.
 */
insert into core.bid_submission
  (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal,
   source_supplier_account_id, supplier_party_id, submitted_at, amount, effective_amount,
   currency, bid_rate, rank, source_status_code_value_id, withdrawal_code_value_id,
   observed_roster_size, observation_id)
select
  revision.auction_revision_id,
  revision.auction_attempt_id,
  revision.opened_at,
  seat.ordinal,
  990000 + seat.party_index,
  990000 + seat.party_index,
  revision.opened_at - interval '2 hours',
  round(revision.planned_amount * seat.bid_rate / 100, 2),
  round(revision.planned_amount * seat.bid_rate / 100, 2),
  'KRW',
  seat.bid_rate,
  seat.ordinal,
  case when seat.ordinal % 6 = 0 then 990142 else 990141 end,
  case when seat.ordinal % 5 = 0 then 990143 else null end,
  spec.roster_size,
  990003
  from core.auction_revision revision
  join lateral (
    select case when (revision.auction_attempt_id - 992000) % 4 = 0
                then 0 else 3 + ((revision.auction_attempt_id - 992000) % 6) end as roster_size
  ) spec on true
  join lateral (
    select ordinal,
           1 + ((revision.auction_attempt_id + ordinal) % 7) as party_index,
           round(88.500 + ((revision.auction_attempt_id * 7 + ordinal * 23) % 70) / 10.0, 3) as bid_rate
      from generate_series(1, spec.roster_size) as ordinal
  ) seat on true
 where revision.auction_attempt_id between 992001 and 992040;

-- 낙찰은 회차마다 0 또는 1이다. 명단이 있어도 낙찰을 관측하지 못한 회차를 남긴다(AGENTS 3).
insert into core.award_decision
  (auction_revision_id, auction_attempt_id, awarded_roster_ordinal,
   source_supplier_account_id, supplier_party_id, awarded_at, awarded_amount, currency,
   awarded_rate, runner_up_rate, source_status_code_value_id, observation_id)
select
  winner.auction_revision_id,
  winner.auction_attempt_id,
  winner.roster_ordinal,
  winner.source_supplier_account_id,
  winner.supplier_party_id,
  winner.opened_at,
  winner.amount,
  winner.currency,
  winner.bid_rate,
  runner_up.bid_rate,
  990141,
  990003
  from (
    select distinct on (roster.auction_revision_id)
           roster.auction_revision_id, roster.auction_attempt_id, roster.roster_ordinal,
           roster.source_supplier_account_id, roster.supplier_party_id, roster.opened_at,
           roster.amount, roster.currency, roster.bid_rate
      from core.bid_submission roster
      join core.auction_revision revision
        on revision.auction_revision_id = roster.auction_revision_id
     where roster.auction_attempt_id between 992001 and 992040
       and roster.auction_attempt_id % 7 <> 0
       and roster.bid_rate >= revision.floor_rate
     order by roster.auction_revision_id, roster.bid_rate, roster.roster_ordinal
  ) winner
  left join lateral (
    select roster.bid_rate
      from core.bid_submission roster
      join core.auction_revision revision
        on revision.auction_revision_id = roster.auction_revision_id
     where roster.auction_revision_id = winner.auction_revision_id
       and roster.roster_ordinal <> winner.roster_ordinal
       and roster.bid_rate >= revision.floor_rate
     order by roster.bid_rate, roster.roster_ordinal
     limit 1
  ) runner_up on true;

-- 재입찰 사슬이다. 게시 종류가 `재입찰`인 열린 공고를 바로 앞 과거 회차에 잇는다. 접미사 문자열이
-- 아니라 내부 시도 id로만 잇는다(AGENTS 4, AGENTS 2).
insert into core.auction_attempt_link
  (auction_revision_id, from_auction_attempt_id, to_auction_attempt_id, relation,
   display_bid_no, source_status_code_value_id, bid_opened_from, bid_closed_at,
   base_amount, planned_amount, currency, observation_id)
select
  revision.auction_revision_id,
  revision.auction_attempt_id,
  992000 + ((revision.auction_attempt_id - 991000) % 40) + 1,
  'parent',
  previous.display_bid_no,
  990141,
  previous.opened_at,
  previous.deadline_at,
  previous.base_amount,
  previous.planned_amount,
  'KRW',
  990003
  from core.auction_revision revision
  join core.auction_revision previous
    on previous.auction_attempt_id = 992000 + ((revision.auction_attempt_id - 991000) % 40) + 1
 where revision.auction_attempt_id between 991001 and 991060
   and (revision.auction_attempt_id - 991000) % 11 = 0;
