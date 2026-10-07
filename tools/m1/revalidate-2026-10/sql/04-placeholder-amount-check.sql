-- 목적: 운영 DB 실격 투찰의 amount가 1e13대 자리표시자임을 같은 공고로 확인한다. 로컬 npz 회차 5744105 = 운영 E260514-608368-0
--       (기초 17,159,500 · 예정 17,134,988 · R 0.99857 · 투찰 68건, 그중 R 미만 28건).
-- 2026-10-07 실측: rank 61~68 행의 amount가 10,000,000,XXX,XXX이고 bid_rate는 88.7~89.3의 실제 값. 88.701% × 예정가격 = 15,199,000원 = npz 최저 투찰.
select r.auction_revision_id, r.display_bid_no, r.base_amount, r.planned_amount, round(r.planned_amount/r.base_amount, 5) rr,
       (select count(*) from core.bid_submission b where b.auction_revision_id = r.auction_revision_id) n
from core.auction_revision r
where r.base_amount = 17159500 and r.opened_at between '2026-04-01' and '2026-07-01'
order by r.auction_revision_id;
select r.floor_rate, b.amount, round(b.amount/(r.base_amount*0.9),5) x, b.rank, b.bid_rate
from core.bid_submission b join core.auction_revision r on r.auction_revision_id=b.auction_revision_id
where b.auction_revision_id = 192279
order by b.rank desc limit 8;

-- (c) 같은 공고의 무효 투찰 수와 자리표시자 수. 2026-10-07 실측: n 68 · 하한 미달 28 · 100% 초과 1 · 자리표시자 29 · 하한 미달 순위 40~67
select count(*) n,
       count(*) filter (where b.bid_rate < r.floor_rate) below_floor,
       count(*) filter (where b.bid_rate > 100) over_100,
       count(*) filter (where b.amount >= 1e12) placeholder_amount,
       min(b.rank) filter (where b.bid_rate < r.floor_rate) min_rank_below,
       max(b.rank) filter (where b.bid_rate < r.floor_rate) max_rank_below
from core.bid_submission b join core.auction_revision r on r.auction_revision_id=b.auction_revision_id
where b.auction_revision_id = 192279;
