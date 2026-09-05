/**
 * @module 책임: mart 조회가 활성 build 하나만 읽도록 하는 SQL 조각과 그 계보 행의 모양을 소유한다.
 *
 * mart 셋이 같은 조회를 쓰므로 회차 이력 어댑터가 이것을 혼자 갖지 않는다.
 */
import { sql, type SQL } from "drizzle-orm";

// `mart.build`의 partial unique index가 mart마다 활성 build를 하나로 강제하므로 이 하위 질의는
// 행을 하나 또는 0개만 돌려준다. 아직 빌드된 적이 없으면 null이고, 그때 목록은 비어야 한다.
// 빈 목록은 오류가 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011, ADR 0034).
export function activeMartBuildId(martName: string): SQL {
  return sql`(select active.build_id from mart.build as active
              where active.mart_name = ${martName} and active.status = 'active')`;
}

/** 활성 build의 계보다. 응답 meta가 어떤 봉인된 입력·계산 규칙을 본 것인지 말할 때 쓴다. */
export type MartBuildLineageRow = Readonly<{
  build_id: string | bigint;
  source_release_id: string;
  calc_version: string;
  computed_at: Date | string | null;
  region_scheme: string | null;
}>;
