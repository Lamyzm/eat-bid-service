-- 목적: 아버지 참여 회차에서 월별 아버지·경쟁자 실격률과 R 대비 위치, 낙찰자 위치, 패배 시 낙찰자와의 거리를 나란히 낸다(bp = 1e-4).
-- 주의: fwin 열은 데이터로 계산한 공고 단위 낙찰이고 award_decision 행 수와 다를 수 있다(05번 참조).
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
fa as (select distinct a from b where f),
per as (
  select max(m) m, a, max(rr) rr, count(*) n,
    min(x) filter (where x>=rr) wx,
    min(x) filter (where f and x>=rr) fbest,
    count(*) filter (where f) fb,
    count(*) filter (where f and x<rr) fsub,
    count(*) filter (where not f and x<rr) osub, count(*) filter (where not f) ob,
    percentile_cont(0.5) within group (order by x) filter (where f) fx,
    percentile_cont(0.5) within group (order by x) filter (where not f) ox
  from b where a in (select a from fa) group by a)
select m, count(*) rnd, sum(fb) fbids,
  count(*) filter (where fbest is not null and fbest=wx) fwin,
  round(100.0*sum(fsub)/sum(fb),1) f_sub,
  round(100.0*sum(osub)/sum(ob),1) o_sub,
  round(percentile_cont(0.5) within group (order by (fx-rr)*10000)::numeric,1) f_dR,
  round(percentile_cont(0.5) within group (order by (ox-rr)*10000)::numeric,1) o_dR,
  round(percentile_cont(0.5) within group (order by (wx-rr)*10000)::numeric,1) w_dR,
  round(percentile_cont(0.5) within group (order by (fbest-wx)*10000) filter (where fbest>wx)::numeric,1) lose_gap,
  percentile_cont(0.5) within group (order by n)::int n_med,
  round(percentile_cont(0.5) within group (order by rr)::numeric,5) rr_med
from per group by m order by m;
