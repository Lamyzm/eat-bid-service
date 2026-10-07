-- 목적: 2026년 9월(모형이 본 적 없는 달) 하한율 90·참여 40~69곳 회차 전체에서 두 장 규칙(0.9855·0.9920)의 낙찰을 2장 제비뽑기 기대와 비교한다.
-- 참여 수는 실격 투찰 포함 전체 투찰 수. x = bid_rate/floor_rate × 예정가격/기초금액. 실격 = x < R (= bid_rate < floor_rate).
-- 2026-10-07 실측: 869회차 · 투찰 46,187 · 실격 20,872(45.2%) · 규칙 41건 vs 기대 33.7건 = 1.217배.
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id,
         base_amount, planned_amount, floor_rate
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount>0 and floor_rate=90
  order by auction_attempt_id, auction_revision_id desc),
b as (
  select b.auction_attempt_id, b.supplier_party_id,
         (b.bid_rate/r.floor_rate) * (r.planned_amount/r.base_amount) as x,
         r.planned_amount/r.base_amount as rr,
         b.bid_rate < r.floor_rate as sub
  from core.bid_submission b join r on r.auction_revision_id=b.auction_revision_id
  where b.bid_rate > 0 and b.bid_rate < 200),
agg as (
  select auction_attempt_id, max(rr) rr, count(*) n, count(*) filter (where sub) nsub,
         min(x) filter (where x>=rr and supplier_party_id not in (1947,1954)) m_oth
  from b group by 1)
select count(*) rounds, sum(nsub) sub_bids, sum(n) all_bids,
       round(100.0*sum(nsub)/sum(n),1) pct_sub,
       sum(case when (0.9855>=rr and (m_oth is null or m_oth>=0.9855))
                  or (0.9920>=rr and (m_oth is null or m_oth>=0.9920)) then 1 else 0 end) rule_win,
       round(sum(2.0/greatest(n,1))::numeric,1) exp2
from agg where n between 40 and 69;
