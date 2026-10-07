-- 목적: 2026년 9월 아버지 참여 회차 전체(하한율 90, 개찰 완료)에 두 장 규칙(0.9855·0.9920)을 대역 구분 없이 넣었을 때의 낙찰 수를
--       참여 수 대역별로 나눠 실제 아버지 낙찰과 비교한다. 참여 수는 실격 투찰을 포함한 전체 투찰 수다(운영 DB에는 투찰 시각이 없어 as-of N을 못 만든다).
-- x = bid_rate/floor_rate × 예정가격/기초금액. 실격 투찰의 amount는 1e13대 자리표시자라 쓰지 않는다.
with rev as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id,
         base_amount, planned_amount, floor_rate
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount > 0 and floor_rate = 90
  order by auction_attempt_id, auction_revision_id desc),
bids as (
  select b.auction_attempt_id, b.supplier_party_id in (1947,1954) as f,
         (b.bid_rate / r.floor_rate) * (r.planned_amount / r.base_amount) as x,
         r.planned_amount / r.base_amount as rr
  from core.bid_submission b join rev r on r.auction_revision_id = b.auction_revision_id
  where b.bid_rate > 0 and b.bid_rate < 200),
agg as (
  select auction_attempt_id, max(rr) rr, count(*) n,
         min(x) filter (where x >= rr and not f) m_oth,
         min(x) filter (where x >= rr) m_all,
         min(x) filter (where f and x >= rr) f_best,
         count(*) filter (where f) fb
  from bids group by 1)
select case when n < 40 then 'N<40' when n <= 69 then 'N40-69' when n <= 119 then 'N70-119' else 'N120+' end band,
       count(*) rounds,
       sum(case when (0.9855 >= rr and (m_oth is null or m_oth >= 0.9855))
                  or (0.9920 >= rr and (m_oth is null or m_oth >= 0.9920)) then 1 else 0 end) rule_win,
       count(*) filter (where f_best is not null and f_best = m_all) father_win,
       round(sum(2.0 / n), 2) lottery2
from agg where fb > 0
group by rollup(1) order by 1 nulls last;
