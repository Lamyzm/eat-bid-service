/**
 * @module 책임: 기관·업체 이름을 그 식별 코드에 매달린 가장 나중 관측 라벨로 고르는 SQL 조각을 서버 reader들이 함께 쓰게 한다.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * 코드 여럿 가운데 가장 나중 관측 라벨 하나다. `codes`는 `code_value_id` 열 하나를 내는 FROM 절 조각이다.
 *
 * **코드마다 가장 나중 한 줄을 index 순서로 먼저 집고**, 그 가운데서 다시 가장 나중을 고른다. 조인한 뒤
 * 정렬하면 PostgreSQL이 `code_label_observation_value_observed_idx`의 순서를 못 쓰고 그 코드의 관측
 * 전부(재수집마다 쌓여 수천 줄)를 읽어 다시 정렬한다. 2026-09-27 운영 실측에서 업체 하나가 333ms, 기관
 * 하나가 50ms였고 이력 한 페이지(51줄)가 20초를 넘겼다. 이 모양으로는 업체 4.6ms, 기관 0.8ms, 한 페이지
 * 160ms이며 답은 같았다.
 */
function latestLabelOf(codes: SQL): SQL {
  return sql`(
    select latest.label
      from ${codes}
      cross join lateral (
        select observation.label, observation.observed_at, observation.code_label_observation_id
          from core.code_label_observation observation
         where observation.code_value_id = owner.code_value_id
         order by observation.observed_at desc, observation.code_label_observation_id desc
         limit 1) latest
     order by latest.observed_at desc, latest.code_label_observation_id desc
     limit 1)`;
}

/**
 * 기관 하나의 표시 이름이다. 없으면 null이다.
 *
 * 이름은 정체성이 아니라 관측이다(AGENTS 2). 그래서 `core.organization.canonical_name`이 아니라 그 기관의
 * 식별 코드에 매달린 관측 라벨을 읽는다. 오늘 목록의 스냅샷이 같은 규칙으로 이름을 싣는다
 * (dataplane `mart/open_auction_snapshot.py` `_FILL_ORGANIZATION_LABEL_SQL`, EAT-39 판정 G). 규칙이 둘이면
 * 같은 기관을 목록과 상세가 다르게 부른다. 운영의 `canonical_name`은 전부 비어 있어 옛 자리를 읽던 상세·
 * 비교 기관 목록은 이름을 한 번도 보여 주지 못했다(2026-09-25, EAT-278).
 */
export function organizationLabelSql(organizationId: SQL): SQL {
  return latestLabelOf(sql`(
    select identifier.code_value_id
      from core.organization_identifier identifier
     where identifier.organization_id = ${organizationId}) owner`);
}

/**
 * 업체 하나의 표시 이름이다. 없으면 null이다. 원천 명단의 업체 이름(SHIPPER_NM)은 그 업체의 원천 계정 코드에
 * 매달린 관측 라벨로 남는다. 한 업체가 계정을 여럿 가질 수 있어 계정 전부에서 가장 나중 것을 고른다.
 */
export function supplierPartyLabelSql(supplierPartyId: SQL): SQL {
  return latestLabelOf(sql`(
    select account.account_code_value_id as code_value_id
      from core.source_supplier_account account
     where account.supplier_party_id = ${supplierPartyId}) owner`);
}
