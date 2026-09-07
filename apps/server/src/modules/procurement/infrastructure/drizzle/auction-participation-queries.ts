/**
 * @module 책임: 공고 한 건의 참여 수(`BID_CNT`) 최신 관측과 하루 전 관측을 `mart.open_auction_snapshot`에서
 * lateral 1행씩으로 닫는 SQL 조각을 소유한다.
 *
 * 열린 공고 목록과 달리 활성 build 하나만 읽지 않는다. 참여 수 추이는 지난 관측점을 되돌아보는 질의라
 * `retain_until` 안에 남은 superseded build의 행까지 같은 시계열로 읽는다(ADR 0034, 스냅샷 mart의
 * `attempt_observed_idx`가 이 질의를 위해 있다). 실패한 build의 행은 사실이 아니므로 읽지 않는다.
 */
import { sql, type SQL } from "drizzle-orm";

const READABLE_BUILD_STATUSES = sql`('active', 'superseded')`;

/** 참여 수가 실제로 관측된(`bid_count`가 null이 아닌) 행만 시계열의 점으로 친다. */
export function latestParticipationJoin(alias: string): SQL {
  return sql`
    left join lateral (
      select snapshot.bid_count, snapshot.observed_at
        from mart.open_auction_snapshot snapshot
        join mart.build build on build.build_id = snapshot.build_id
       where snapshot.auction_attempt_id = attempt.auction_attempt_id
         and snapshot.bid_count is not null
         and build.status in ${READABLE_BUILD_STATUSES}
       order by snapshot.observed_at desc, snapshot.open_auction_snapshot_id desc
       limit 1
    ) ${sql.raw(alias)} on true`;
}

/**
 * "어제"는 달력 날짜가 아니라 최신 관측에서 24시간 이상 앞선 관측 중 가장 늦은 것이다. 달력으로
 * 자르면 자정 직후 관측은 몇 분 전 값과 비교돼 "어제보다 +0"이라는 거짓을 만든다.
 */
export function dayEarlierParticipationJoin(latestAlias: string, alias: string): SQL {
  return sql`
    left join lateral (
      select snapshot.bid_count, snapshot.observed_at
        from mart.open_auction_snapshot snapshot
        join mart.build build on build.build_id = snapshot.build_id
       where snapshot.auction_attempt_id = attempt.auction_attempt_id
         and snapshot.bid_count is not null
         and build.status in ${READABLE_BUILD_STATUSES}
         and snapshot.observed_at <= ${sql.raw(latestAlias)}.observed_at - interval '24 hours'
       order by snapshot.observed_at desc, snapshot.open_auction_snapshot_id desc
       limit 1
    ) ${sql.raw(alias)} on true`;
}
