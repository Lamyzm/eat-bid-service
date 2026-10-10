-- 목적: (EAT-324) 2026-06~09 개찰된 하한율 90 공고 중 오뚜기축산(1947)·신성유통(1954)이 넣은 공고의 모든 투찰을 꺼내, 매달 다시 고르기의 9월 채점과 10월 금액 계산에 쓴다.
-- x = bid_rate/floor_rate × 예정가격/기초금액 (= 투찰 금액 ÷ (기초금액 × 하한율)). 실격 투찰 amount는 1e13대 자리표시자라 쓰지 않는다.
-- 최신 개정본은 관측 번호(observation_id) 순으로 고른다. 2026-09 회차는 개정본 번호가 큰 쪽이 옛 관측인 경우가 1만 건을 넘어
-- 번호 순으로 고르면 명단 없는 '진행중' 스냅숏이 잡혔다. 관측 번호 순은 2024-01~2026-09 모든 달에서 관측 시각 순과 같았다.
set max_parallel_workers_per_gather = 0;
set statement_timeout = '180s';
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id, base_amount, planned_amount, floor_rate, opened_at
  from core.auction_revision
  where opened_at >= '2026-06-01' and opened_at < '2026-10-01'
    and planned_amount is not null and base_amount > 0 and floor_rate = 90
  order by auction_attempt_id, observation_id desc, auction_revision_id desc),
f as (
  select distinct r.auction_attempt_id
  from r join core.bid_submission b on b.auction_revision_id = r.auction_revision_id
  where b.supplier_party_id in (1947, 1954))
select a.external_bid_id, to_char(r.opened_at at time zone 'Asia/Seoul', 'YYYYMM') ym,
       r.base_amount, r.planned_amount, coalesce(b.supplier_party_id, 0) sp,
       (b.bid_rate / r.floor_rate) * (r.planned_amount / r.base_amount) x
from r join f using (auction_attempt_id)
join core.auction_attempt a on a.auction_attempt_id = r.auction_attempt_id
join core.bid_submission b on b.auction_revision_id = r.auction_revision_id
where b.bid_rate > 0 and b.bid_rate < 200;
