-- 목적: 월별 공고·투찰 수집량과 개찰 결과 수집률로 데이터 구멍을 찾는다.
-- 2026-10-07 실측: 7월은 평소의 약 1/4(3,732 공고), 10월은 수집 중단(152 공고). 9월은 정상(16,393 공고 · 결과 89.9%).
-- (a) 월별 공고·투찰·아버지 투찰
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id,
         date_trunc('month', opened_at at time zone 'Asia/Seoul') m, auction_revision_id
  from core.auction_revision
  where opened_at >= '2026-01-01'
  order by auction_attempt_id, auction_revision_id desc)
select to_char(r.m,'YYYY-MM') ym, count(*) attempts,
       (select count(*) from core.bid_submission b join r r2 on r2.auction_revision_id=b.auction_revision_id where r2.m=r.m) bids,
       (select count(*) from core.bid_submission b join r r2 on r2.auction_revision_id=b.auction_revision_id
         where r2.m=r.m and b.supplier_party_id in (1947,1954)) father_bids
from r group by r.m order by 1;

-- (b) 월별 개찰 결과 수집률 (공고 단위)
with r as (
  select distinct on (auction_attempt_id) auction_attempt_id, auction_revision_id,
         date_trunc('month', opened_at at time zone 'Asia/Seoul') m
  from core.auction_revision where opened_at >= '2026-04-01'
  order by auction_attempt_id, auction_revision_id desc)
select to_char(r.m,'YYYY-MM') ym, count(*) attempts,
  (select count(*) from core.award_decision a join r r2 on r2.auction_revision_id=a.auction_revision_id where r2.m=r.m) awards,
  round(100.0*(select count(*) from core.award_decision a join r r2 on r2.auction_revision_id=a.auction_revision_id where r2.m=r.m)/count(*),1) pct
from r group by r.m order by 1;
