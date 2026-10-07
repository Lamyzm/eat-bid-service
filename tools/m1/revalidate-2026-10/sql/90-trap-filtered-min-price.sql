-- 함정 재현용. 쓰지 말 것.
-- amount < 1e11 또는 x ∈ [0.90, 1.10] 필터는 실격 투찰(1e13대 자리표시자)을 지운다. 그 뒤 남은 최저가가 낙찰자인 것은 동어반복이다.
-- 2026-10-07에 이 쿼리들로 "99.34%가 최저가 낙찰", "실격 0%"라는 틀린 결론을 냈다. 실제 9월 실격률은 45.2%다(01번).
-- (a) 동어반복 최저가
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01' and planned_amount is not null
  order by auction_attempt_id, auction_revision_id desc),
b as (select r.auction_attempt_id, b.auction_revision_id, b.amount, b.rank
      from core.bid_submission b join r on r.auction_revision_id=b.auction_revision_id
      where b.amount>0 and b.amount<1e11),
mn as (select auction_attempt_id, min(amount) mina, count(*) n from b group by 1)
select count(*) rounds,
  count(*) filter (where a.awarded_amount = mn.mina) winner_is_min,
  round(100.0*count(*) filter (where a.awarded_amount = mn.mina)/count(*),2) pct,
  round(avg(mn.n)::numeric,1) n_avg
from core.award_decision a
join r on r.auction_revision_id=a.auction_revision_id
join mn on mn.auction_attempt_id=a.auction_attempt_id
where mn.n>=5;

-- (b) 실격을 지운 뒤의 실격률
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id, base_amount, planned_amount
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount>0 and floor_rate=90
  order by auction_attempt_id, auction_revision_id desc),
b as (select b.amount/(r.base_amount*0.9) x, r.planned_amount/r.base_amount rr
      from core.bid_submission b join r on r.auction_revision_id=b.auction_revision_id
      where b.amount>0 and b.amount < 1e11)
select count(*) bids,
       count(*) filter (where x < rr) below_floor,
       round(100.0*count(*) filter (where x<rr)/count(*),2) pct_below,
       count(*) filter (where x < 0.90) very_low,
       percentile_cont(0.01) within group (order by x)::numeric(10,5) p01,
       percentile_cont(0.50) within group (order by x)::numeric(10,5) p50
from b;
