/**
 * @module 책임: 기관 이름을 기관 코드에 매달린 가장 나중 관측 라벨로 고르는 SQL 한 조각을 서버 reader들이 함께 쓰게 한다.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * 기관 하나의 표시 이름이다. 없으면 null이다.
 *
 * 이름은 정체성이 아니라 관측이다(AGENTS 2). 그래서 `core.organization.canonical_name`이 아니라 그 기관의
 * 식별 코드에 매달린 관측 라벨을 읽는다. 오늘 목록의 스냅샷이 같은 규칙으로 이름을 싣는다
 * (dataplane `mart/open_auction_snapshot.py` `_FILL_ORGANIZATION_LABEL_SQL`, EAT-39 판정 G). 규칙이 둘이면
 * 같은 기관을 목록과 상세가 다르게 부른다. 운영의 `canonical_name`은 전부 비어 있어 옛 자리를 읽던 상세·
 * 비교 기관 목록은 이름을 한 번도 보여 주지 못했다(2026-09-25, EAT-278).
 *
 * 정렬은 관측 시각 역순, 같은 시각이면 관측 id 역순이다. `code_label_observation`의 조회 index가 이
 * 정렬을 그대로 준다.
 */
export function organizationLabelSql(organizationId: SQL): SQL {
  return sql`(
    select observation.label
      from core.organization_identifier identifier
      join core.code_label_observation observation
        on observation.code_value_id = identifier.code_value_id
     where identifier.organization_id = ${organizationId}
     order by observation.observed_at desc, observation.code_label_observation_id desc
     limit 1)`;
}
