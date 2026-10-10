-- 목적: 2026-09(선택 절차가 본 적 없는 달) 하한율 90·88 회차에서 대역별 1~3장 규칙(규칙 2026-10-10)의 낙찰을 공정한 제비뽑기 기대 k/(N+k)와 비교한다.
-- 참여 수 N은 아버지 두 사업자(1947·1954)를 뺀 실격 포함 최종 투찰 수다(운영 DB에 투찰 시각이 없다). 규칙 표는 그 N개에 더해지는 k장이다.
set max_parallel_workers_per_gather = 0;
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id, base_amount, planned_amount, floor_rate
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount > 0 and floor_rate in (90, 88)
  order by auction_attempt_id, auction_revision_id desc),
b as (
  select b.auction_attempt_id, b.supplier_party_id, r.floor_rate,
         (b.bid_rate / r.floor_rate) * (r.planned_amount / r.base_amount) as x,
         r.planned_amount / r.base_amount as rr
  from core.bid_submission b join r on r.auction_revision_id = b.auction_revision_id
  where b.bid_rate > 0 and b.bid_rate < 200 and b.supplier_party_id not in (1947, 1954)),
agg as (
  select auction_attempt_id, max(floor_rate) floor_rate, max(rr) rr, count(*) n,
         min(x) filter (where x >= rr) m_oth
  from b group by 1),
rules(floor_rate, lo, hi, pos, v) as (values
  (90,2,9,1,1.0040),(90,2,9,2,0.9960),(90,2,9,3,1.0000),(90,10,19,1,0.9925),(90,10,19,2,1.0000),(90,10,19,3,0.9960),(90,20,29,1,0.9925),(90,20,29,2,0.9885),(90,20,29,3,0.9970),(90,30,39,1,0.9885),(90,30,39,2,0.9935),(90,30,39,3,0.9985),(90,40,69,1,0.9860),(90,40,69,2,0.9920),(90,40,69,3,0.9955),(90,70,100000,1,0.9835),(90,70,100000,2,0.9890),(90,70,100000,3,0.9910),(88,2,9,1,1.0040),(88,2,9,2,0.9960),(88,2,9,3,1.0010),(88,10,19,1,0.9960),(88,10,19,2,1.0020),(88,10,19,3,0.9920),(88,20,29,1,0.9930),(88,20,29,2,0.9980),(88,20,29,3,0.9905),(88,30,39,1,0.9945),(88,30,39,2,0.9980),(88,30,39,3,1.0010),(88,40,69,1,0.9905),(88,40,69,2,0.9945),(88,40,69,3,0.9850),(88,70,100000,1,0.9855),(88,70,100000,2,0.9905),(88,70,100000,3,0.9945)),
bands as (select distinct floor_rate, lo, hi from rules),
scored as (
  select bd.floor_rate, bd.lo, k.k, a.n,
         exists (select 1 from rules ru where ru.floor_rate = bd.floor_rate and ru.lo = bd.lo and ru.pos <= k.k
                 and ru.v >= a.rr and (a.m_oth is null or a.m_oth >= ru.v)) as win
  from agg a join bands bd on a.floor_rate = bd.floor_rate and a.n between bd.lo and bd.hi
  cross join (values (1),(2),(3)) k(k))
select floor_rate, lo, k, count(*) rounds, sum(win::int) wins,
       round(sum(k::numeric / (n + k)), 1) lottery,
       round(sum(win::int) / nullif(sum(k::numeric / (n + k)), 0), 3) multiple
from scored group by 1,2,3 order by 1 desc,2,3;
