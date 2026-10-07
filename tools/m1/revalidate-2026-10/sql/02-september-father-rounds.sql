-- 목적: 두 장 규칙(0.9855·0.9920)이 2026년 9월 아버지 참여 회차(참여 40~69곳) 중 어디서 낙찰했을지 공고 단위로 꺼낸다.
-- 투찰률 x = bid_rate/floor_rate × 예정가격/기초금액 (= 투찰가 / (기초금액 × 낙찰하한율)). 실격은 x < R 이고 bid_rate < floor_rate 와 같다.
-- amount 열은 실격 투찰에 1e13대 자리표시자를 쓰므로 쓰지 않는다(AUDIT-PIPELINE.md §5-①, domain-and-data.md).
-- 아버지 사업자: supplier_party_id 1947(3118152843), 1954(7175001228). 아버지 투찰은 경쟁자에서 뺀다.
-- 2026-10-07 실측: 2행(김해구산중 육류, 김해대곡중 육류).
with rev as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id,
         base_amount, planned_amount, floor_rate, title
  from core.auction_revision
  where opened_at >= '2026-09-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount > 0 and floor_rate = 90
  order by auction_attempt_id, auction_revision_id desc),
bids as (
  select b.auction_attempt_id, b.supplier_party_id,
         (b.bid_rate / r.floor_rate) * (r.planned_amount / r.base_amount) as x,
         r.planned_amount / r.base_amount as rr
  from core.bid_submission b join rev r on r.auction_revision_id = b.auction_revision_id
  where b.bid_rate > 0 and b.bid_rate < 200),
agg as (
  select auction_attempt_id, max(rr) rr, count(*) n,
         min(x) filter (where x >= rr and supplier_party_id not in (1947,1954)) m_oth,
         count(*) filter (where supplier_party_id in (1947,1954)) fbids,
         min(x) filter (where supplier_party_id in (1947,1954) and x >= rr) f_best
  from bids group by 1)
select left(r.title, 34) title, r.base_amount::bigint base,
       round(r.base_amount * r.floor_rate / 100 * 0.9855) bid1,
       round(r.base_amount * r.floor_rate / 100 * 0.9920) bid2,
       round(a.rr::numeric, 5) rr, round(a.f_best::numeric, 5) father_best_valid_x, a.n
from agg a join rev r on r.auction_attempt_id = a.auction_attempt_id
where a.fbids > 0 and a.n between 40 and 69
  and ((0.9855 >= a.rr and (a.m_oth is null or a.m_oth >= 0.9855))
    or (0.9920 >= a.rr and (a.m_oth is null or a.m_oth >= 0.9920)));
