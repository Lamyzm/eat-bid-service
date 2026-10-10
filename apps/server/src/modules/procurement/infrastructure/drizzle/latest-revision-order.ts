/** @module 책임: 공고 시도의 "최신 개정본"을 고르는 정렬 규칙을 서버 조회 전체가 함께 쓰도록 한곳에 둔다(EAT-333, ADR 0065). */
import { sql, type SQL } from "drizzle-orm";

/**
 * 최신은 개정본 번호가 아니라 관측 번호 순이다. 개정본 번호는 투영 순서라서, 재처리가 옛 관측을 다시 투영하거나 오래 걸린
 * 정시 수집 회차가 늦게 투영하면 번호가 커도 옛 상태가 된다(2026-09 회차 11,162건 중 10,849건). 관측 번호는 raw를 받은 순서이고
 * 모든 달에서 관측 시각 순과 같았다. 같은 관측을 다시 해석한 개정본이 여럿이면 나중 해석을 쓴다.
 *
 * `alias`는 `core.auction_revision`을 가리키는 별칭이다. 사용자 입력이 아니라 조회 안의 고정 식별자만 받는다.
 */
export function latestRevisionOrder(alias: string): SQL {
  const revision = sql.raw(alias);
  return sql`${revision}.observation_id desc, ${revision}.auction_revision_id desc`;
}
