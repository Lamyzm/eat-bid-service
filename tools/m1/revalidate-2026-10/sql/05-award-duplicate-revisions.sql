-- 목적: core.award_decision이 같은 공고의 개정본(revision)마다 한 줄씩 있어 공고 단위로 세려면 distinct auction_attempt_id가 필요함을 보인다.
-- 2026-10-07 실측(아버지 낙찰): 5월 행 11 / 공고 5 · 6월 8 / 3 · 7월 3 / 1. 행으로 세면 "11→8→3→1→0 붕괴"처럼 보인다.
select to_char(r.opened_at at time zone 'Asia/Seoul','YYYY-MM') m,
       count(*) rows, count(distinct a.auction_attempt_id) attempts
from core.award_decision a join core.auction_revision r on r.auction_revision_id=a.auction_revision_id
where a.supplier_party_id in (1947,1954) and r.opened_at >= '2026-02-01'
group by 1 order by 1;
