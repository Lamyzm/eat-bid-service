/**
 * @module 책임: 공고 한 건이 보여 주는 revision에 최신 관측이 반영됐는지를 활성 build의 `mart.build_stale_auction`에서
 * 한 행으로 닫는 SQL 조각을 소유한다.
 *
 * 서버는 발행 제외 원장(ingest)을 읽지 않는다. 판정은 dataplane mart 빌더가 원장에서 파생해 build마다 실어 두고
 * 여기서는 그 행만 읽는다(ADR 0061 결정 5, EAT-295).
 */
import { sql, type SQL } from "drizzle-orm";

// 제외 부속 행은 모든 mart build에 실린다. 그중 가장 자주 다시 만들어지는 열린 공고 스냅샷의 활성 build를 읽는다 —
// 정시 수집이 발행할 때마다 새 build가 되므로 미반영 표시가 한 회차 안에 따라온다. 회차 요약은 하루 몇 번의 예약으로만
// 다시 만들어져 그 build를 읽으면 표시가 반나절 늦을 수 있다(ADR 0060 결정 3). 이름을 `drizzle-mart-build-reader`
// 에서 가져오지 않는 이유는 그 모듈이 이 조각을 쓰는 공고 reader의 시간 경계를 import해 순환이 생기기 때문이다.
const STALE_SOURCE_MART = "open_auction_snapshot";

/** 판정 재료가 있는가다. 활성 build가 없으면 모른다고 말해야 하므로 행의 유무와 따로 싣는다. */
export function latestObservationBuildColumn(): SQL {
  return sql`(select active.build_id from mart.build active
              where active.mart_name = ${STALE_SOURCE_MART} and active.status = 'active')`;
}

/**
 * 지금 보여 주는 revision과 build가 본 현행 revision이 같을 때만 붙인다. build 뒤에 새 revision이 발행됐다면 그
 * 표시는 이미 틀린 말이다 — 새 발행은 곧 새 build를 만들고, 그 사이에는 반영된 것으로 읽는 편이 사실에 가깝다.
 */
export function staleAuctionJoin(alias: string): SQL {
  return sql`
    left join mart.build_stale_auction ${sql.raw(alias)}
      on ${sql.raw(alias)}.build_id = ${latestObservationBuildColumn()}
     and ${sql.raw(alias)}.auction_attempt_id = attempt.auction_attempt_id
     and ${sql.raw(alias)}.auction_revision_id = revision.auction_revision_id`;
}
