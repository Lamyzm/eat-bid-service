/**
 * @module 책임: 지역 선택 미리보기가 오늘 세 숫자와 과거 창 관측을 읽는 SQL을 소유한다.
 *
 * 오늘 숫자는 활성 스냅샷 build에서, 과거 창은 core 관측에서 온다. 두 출처를 한 조회로 합치지 않는
 * 이유는 build 하나가 성수기 하루를 담지 못하기 때문이다 — 스냅샷은 "지금 열린 것"이고 성수기는 이미
 * 마감된 날들이다(ADR 0034).
 */
import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";

import { KST_TIME_ZONE } from "../../domain/kst-month";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import {
  eligibilityMatchedExpression,
  eligibilityObservedExpression,
  matchedEligibilityAreaCte,
} from "./eligibility-area-sql";
import { OPEN_AUCTION_SNAPSHOT } from "./open-auction-queries";

function instantParameter(value: Temporal.Instant): string {
  return value.toString();
}

/**
 * 지금 열린 공고에 그 선택을 적용한 세 숫자다. "열림" 판정은 목록과 같아야 해서 같은 조건
 * (`closes_at is null or closes_at > asOf`)을 쓴다. 다른 필터는 걸지 않는다 — 분모가 "전국 몇 건"이어야
 * 화면이 "404건이 9건이 된다"고 말할 수 있다.
 */
export function coverageTodayQuery(input: {
  readonly asOf: Temporal.Instant;
  readonly codeValueIds: readonly bigint[];
}): SQL {
  const asOf = instantParameter(input.asOf);
  return sql`
    with ${matchedEligibilityAreaCte(input.codeValueIds)},
    snapshot as (
      select distinct on (snapshot.auction_attempt_id)
        snapshot.auction_attempt_id,
        snapshot.terms_revision_id,
        snapshot.closes_at
      from mart.open_auction_snapshot snapshot
      where snapshot.build_id = ${activeMartBuildId(OPEN_AUCTION_SNAPSHOT)}
      order by snapshot.auction_attempt_id, snapshot.observed_at desc
    ),
    open_rows as (
      select snapshot.auction_attempt_id,
             ${eligibilityObservedExpression(sql`snapshot.terms_revision_id`)} as eligibility_observed,
             ${eligibilityMatchedExpression(sql`snapshot.terms_revision_id`)} as eligibility_matched
      from snapshot
      where snapshot.closes_at is null or snapshot.closes_at > ${asOf}::timestamptz
    )
    select count(*)::int as nationwide_count,
           count(*) filter (where open_rows.eligibility_matched)::int as matched_count,
           count(*) filter (where not open_rows.eligibility_observed)::int as unobserved_count
      from open_rows
  `;
}

/**
 * 과거 창의 하루별 마감 건수다.
 *
 * 왜 마감(`deadline_at`)인가: 사용자가 화면을 여는 날은 낼 것을 골라야 하는 날, 곧 마감이 몰린 날이다.
 * 공고일로 세면 같은 덩어리가 며칠 앞으로 밀려 사용자의 달력과 어긋난다. 실측에서 김해 기준 하루 최대
 * 117건이 2026-06-22 마감에 몰렸다.
 *
 * attempt마다 revision 하나만 세는 이유는 정정이 같은 공고를 여러 번 세지 않게 하기 위해서다. 가장 큰
 * `auction_revision_id`가 마지막으로 관측된 조건이다.
 *
 * 하루의 경계는 KST다. 그 시간대 이름의 선언은 `domain/kst-month.ts` 하나이며 여기서 다시 적지 않는다.
 */
export function coverageWindowQuery(input: {
  readonly asOf: Temporal.Instant;
  readonly windowStart: Temporal.Instant;
  readonly codeValueIds: readonly bigint[];
}): SQL {
  const windowStart = instantParameter(input.windowStart);
  const windowEnd = instantParameter(input.asOf);
  return sql`
    with ${matchedEligibilityAreaCte(input.codeValueIds)},
    latest as (
      select distinct on (revision.auction_attempt_id)
        revision.auction_attempt_id,
        revision.auction_revision_id,
        revision.deadline_at
      from core.auction_revision revision
      where revision.deadline_at >= ${windowStart}::timestamptz
        and revision.deadline_at < ${windowEnd}::timestamptz
      order by revision.auction_attempt_id, revision.auction_revision_id desc
    ),
    matched as (
      select latest.deadline_at
        from latest
       where ${eligibilityMatchedExpression(sql`latest.auction_revision_id`)}
    ),
    by_day as (
      select (matched.deadline_at at time zone ${KST_TIME_ZONE})::date as day, count(*)::int as day_count
        from matched
       group by 1
    )
    select (select count(*)::int from by_day) as days_with_auctions,
           (select percentile_disc(0.5) within group (order by by_day.day_count) from by_day)::int as median_day_count,
           (select to_char(by_day.day, 'YYYY-MM-DD') from by_day order by by_day.day_count desc, by_day.day desc limit 1)
             as peak_date,
           (select max(by_day.day_count)::int from by_day) as peak_count
  `;
}
