-- 목적: 아버지 2026년 월별 낙찰을 공고 단위로 세고 Σ(아버지 투찰 수 / 회차 투찰 수) 기대와 비교한다.
-- 2026-10-07 실측: 2월 2/2.54 · 3월 0/2.32 · 4월 2/2.00 · 5월 5/2.22 · 6월 3/2.16 · 7월 1/0.72 · 8월 1/2.10 · 9월 0/2.16 · 합 14/16.22.
--   월별 카이제곱 약 9.1(자유도 7~8, p≈0.25) — 운의 범위.
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id,
         base_amount, planned_amount, floor_rate,
         to_char(opened_at at time zone 'Asia/Seoul','YYYY-MM') m
  from core.auction_revision
  where opened_at >= '2026-02-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount>0 and floor_rate is not null
  order by auction_attempt_id, auction_revision_id desc),
b as (
  select r.m, b.auction_attempt_id a, b.supplier_party_id in (1947,1954) f,
         (b.bid_rate/r.floor_rate)*(r.planned_amount/r.base_amount) x,
         r.planned_amount/r.base_amount rr
  from core.bid_submission b join r on r.auction_revision_id=b.auction_revision_id
  where b.bid_rate>0 and b.bid_rate<200),
per as (
  select max(m) m, a, count(*) n, count(*) filter (where f) fb,
         min(x) filter (where x>=max_rr) wx, min(x) filter (where f and x>=max_rr) fbest
  from (select *, max(rr) over (partition by a) max_rr from b) t
  group by a having count(*) filter (where f) > 0)
select m, count(*) rnd,
       round(sum(fb::numeric/n),2) expct,
       count(*) filter (where fbest is not null and fbest=wx) actual
from per group by rollup(m) order by m nulls last;
