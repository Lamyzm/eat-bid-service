-- 목적: 2026-09(선택 절차가 본 적 없는 달) 하한율 90 회차에서 대역별 1~3장 규칙(새 값·현행 값)의 낙찰을 같은 장수 제비뽑기 기대와 비교한다.
-- 참여 수는 실격 포함 최종 투찰 수(운영 DB에 투찰 시각이 없어 as-of를 만들 수 없다). 아버지 두 사업자(1947·1954)의 투찰은 경쟁자에서 뺀다.
set max_parallel_workers_per_gather = 0;
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id, base_amount, planned_amount, floor_rate
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount > 0 and floor_rate = 90
  order by auction_attempt_id, auction_revision_id desc),
b as (
  select b.auction_attempt_id, b.supplier_party_id,
         (b.bid_rate / r.floor_rate) * (r.planned_amount / r.base_amount) as x,
         r.planned_amount / r.base_amount as rr
  from core.bid_submission b join r on r.auction_revision_id = b.auction_revision_id
  where b.bid_rate > 0 and b.bid_rate < 200),
agg as (
  select auction_attempt_id, max(rr) rr, count(*) n,
         min(x) filter (where x >= rr and supplier_party_id not in (1947, 1954)) m_oth
  from b group by 1),
rules(version, lo, hi, pos, v) as (values
  ('new',10,19,1,0.9925),('new',10,19,2,1.0000),('new',10,19,3,0.9960),
  ('new',20,29,1,0.9925),('new',20,29,2,0.9885),('new',20,29,3,0.9970),
  ('new',30,39,1,0.9885),('new',30,39,2,0.9935),('new',30,39,3,0.9985),
  ('new',40,69,1,0.9860),('new',40,69,2,0.9920),('new',40,69,3,0.9955),
  ('new',70,100000,1,0.9835),('new',70,100000,2,0.9890),('new',70,100000,3,0.9910),
  ('cur',40,69,1,0.9855),('cur',40,69,2,0.9920),('cur',40,69,3,0.9945),
  ('cur',70,100000,1,0.9830),('cur',70,100000,2,0.9900),('cur',70,100000,3,0.9880)),
bands as (select distinct version, lo, hi from rules),
scored as (
  select bd.version, bd.lo, k.k, a.auction_attempt_id, a.n,
         exists (select 1 from rules ru where ru.version = bd.version and ru.lo = bd.lo and ru.pos <= k.k
                 and ru.v >= a.rr and (a.m_oth is null or a.m_oth >= ru.v)) as win
  from agg a join bands bd on a.n between bd.lo and bd.hi
  cross join (values (1),(2),(3)) k(k))
select version, lo, k, count(*) rounds, sum(win::int) wins,
       round(sum(least(k::numeric / greatest(n,1), 1)), 1) lottery,
       round(sum(win::int) / nullif(sum(least(k::numeric / greatest(n,1), 1)), 0), 3) multiple
from scored group by 1,2,3 order by 2,1,3;
