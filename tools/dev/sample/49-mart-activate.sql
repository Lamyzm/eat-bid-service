-- 책임: 개발 표본 mart build의 상태 전이(검증·활성·물림)를 모든 행을 심은 뒤 한 번에 닫는다.
--
-- 40-mart.sql에서 떼어 낸 이유: 활성 build에는 행을 더할 수 없다(트리거 `enforce_mart_row_build_is_building`).
-- 45-comparison.sql이 같은 build에 비교 집단 행을 더하려면 전이가 모든 행 뒤에 와야 한다.

-- 상태 전이를 마지막에 한다. 행 수를 세고 나서야 `검증했다`고 말할 수 있고, 활성 build는 mart마다
-- 하나뿐이라 물린 build의 전이도 여기서 함께 닫는다.
update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.open_auction_snapshot snapshot
                     where snapshot.build_id = mart.build.build_id)
 where build_id in (995001, 995002);

update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.org_round_summary summary
                     where summary.build_id = mart.build.build_id)
 where build_id = 995003;

update mart.build
   set status = 'verified',
       computed_at = started_at + interval '5 minutes',
       row_count = (select count(*) from mart.win_rate_distribution_monthly distribution
                     where distribution.build_id = mart.build.build_id)
 where build_id = 995004;

update mart.build
   set status = 'active', activated_at = computed_at + interval '1 minute'
 where build_id in (995002);

update mart.build
   set status = 'superseded',
       superseded_at = now() - interval '2 hours',
       retain_until = now() + interval '7 days'
 where build_id = 995002;

update mart.build
   set status = 'active', activated_at = computed_at + interval '1 minute'
 where build_id in (995001, 995003, 995004);
