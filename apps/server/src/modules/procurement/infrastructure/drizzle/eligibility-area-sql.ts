/**
 * @module 책임: eaT 참가제한지역으로 공고를 거르고 그 코드를 시도 묶음으로 읽는 SQL 조각을 한 곳에서
 * 소유한다.
 *
 * 규칙이 두 곳에 살면 목록이 세는 수와 저장 전 미리보기가 보여 주는 수가 조용히 갈라진다. 목록 필터·
 * 표본 수·미리보기 세 조회가 모두 여기서 나온 같은 CTE를 쓴다.
 */
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import { sql, type SQL } from "drizzle-orm";

import { bigintArrayLiteral } from "../../../../platform/database/sql-values";

/**
 * `core.auction_revision_code_value.role` 중 참가제한지역 축의 값이다. 같은 표에 공고지역
 * (`location_sido`·`location_sigungu`)도 함께 살기 때문에 role을 걸지 않으면 두 체계가 한 질의에서
 * 섞인다(AGENTS 6).
 */
export const ELIGIBILITY_AREA_ROLE = "eligibility_area";

/**
 * 저장된 코드 집합 그대로가 매칭 집합이다. 질의가 코드를 스스로 넓히지 않는다.
 *
 * 계층은 사라지지 않았고 자리가 다르다. `경남/김해시`를 고르면 `경남/전체`가 **선택 시점에** 함께 켜지고
 * 그 사실이 고른 목록에 보이며 사용자가 뺄 수 있다(ADR 0048 결정 2). 여기서 다시 넓히면 사용자가 일부러
 * 뺀 `경남/전체`가 질의에서 되살아나 화면이 보여 준 선택과 실제 결과가 어긋난다. 시안이 "김해시만 두면
 * 오늘 2건, 경남 전체까지 있으면 9건"이라고 적은 것도 같은 뜻이다 — 두 수가 갈리려면 질의가 저장된
 * 집합을 그대로 따라야 한다.
 *
 * 체계를 함께 거는 이유는 `code_value_id`가 체계를 넘나드는 정수라서다. 참가제한지역 아닌 코드가 섞여
 * 들어오면 그것이 규칙 6이 금지하는 체계 혼용이 된다.
 */
export function matchedEligibilityAreaCte(codeValueIds: readonly bigint[]): SQL {
  return sql`
    matched_eligibility_area as (
      select selected.code_value_id
      from core.code_value selected
      join core.code_scheme scheme
        on scheme.code_scheme_id = selected.code_scheme_id
       and scheme.namespace = ${CODE_SCHEME_NAMES.eligibilityArea}
      where selected.code_value_id = any(${bigintArrayLiteral(codeValueIds)}::bigint[])
    )
  `;
}

/** 이 revision이 참가제한지역을 하나라도 관측했는가. 관측 없음은 "제한 없음"이 아니다(AGENTS 3). */
export function eligibilityObservedExpression(revisionColumn: SQL): SQL {
  return sql`exists (
    select 1 from core.auction_revision_code_value link
     where link.auction_revision_id = ${revisionColumn}
       and link.role = ${ELIGIBILITY_AREA_ROLE}
  )`;
}

/** 이 revision의 제한지역이 매칭 집합과 겹치는가. */
export function eligibilityMatchedExpression(revisionColumn: SQL): SQL {
  return sql`exists (
    select 1 from core.auction_revision_code_value link
     where link.auction_revision_id = ${revisionColumn}
       and link.role = ${ELIGIBILITY_AREA_ROLE}
       and link.code_value_id in (select code_value_id from matched_eligibility_area)
  )`;
}

/**
 * 이 체계의 코드와 최신 관측 라벨을 한 이름으로 묶는 CTE다. 목록과 선택 화면이 라벨을 서로 다르게
 * 고르면 같은 코드가 두 화면에서 다른 이름으로 불린다.
 *
 * **재사용을 강제하지는 않는다.** PostgreSQL은 한 번만 참조되는 CTE를 inline하므로 목록 질의에서는
 * 행마다 라벨을 다시 찾는다. `materialized`를 붙이지 않는 이유는 그편이 실측에서 이기기 때문이다 —
 * 라벨 조회는 `code_label_observation_value_observed_idx` 위 0.007ms짜리이고 페이지 하나에서 170회
 * 남짓 돈다(복원본 build 212, 101행 페이지). 186행을 미리 펼쳐 index 없는 CTE scan으로 만드는 쪽이
 * 오히려 비싸다. 반복 횟수를 줄이는 자리는 여기가 아니라 lateral을 페이지 행에만 돌리는
 * `open-auction-queries.ts`의 `page_rows`다.
 *
 * `left(code, 2)`는 그 시도의 `전체` 코드를 가리키는 접두사이며 선택 목록만 그것을 읽는다.
 */
export function eligibilityAreaCodeCte(): SQL {
  return sql`
    eligibility_area_code as (
      select code.code_value_id,
             code.code,
             scheme.namespace as scheme,
             left(code.code, 2) as sido_prefix,
             (select observation.label
                from core.code_label_observation observation
               where observation.code_value_id = code.code_value_id
               order by observation.observed_at desc, observation.code_label_observation_id desc
               limit 1) as label
        from core.code_value code
        join core.code_scheme scheme on scheme.code_scheme_id = code.code_scheme_id
       where scheme.namespace = ${CODE_SCHEME_NAMES.eligibilityArea}
    )
  `;
}

/**
 * 행마다 실린 제한지역 코드 목록이다. 관측이 없으면 `json_agg`가 null을 돌려주고 그 null이 그대로
 * `제한지역 미관측`이 된다 — 빈 배열로 바꾸면 "제한이 없는 공고"와 구분이 사라진다.
 *
 * `code_value_id`를 문자열로 싣는 이유는 JSON 숫자가 bigint를 무손실로 담지 못하기 때문이다(ADR 0018).
 */
export function eligibilityAreasLateral(revisionColumn: SQL, alias: string): SQL {
  return sql`
    left join lateral (
      select json_agg(
               json_build_object(
                 'code_value_id', code.code_value_id::text,
                 'code', code.code,
                 'scheme', code.scheme,
                 'label', code.label
               )
               order by code.code
             ) as areas
        from core.auction_revision_code_value link
        join eligibility_area_code code on code.code_value_id = link.code_value_id
       where link.auction_revision_id = ${revisionColumn}
         and link.role = ${ELIGIBILITY_AREA_ROLE}
    ) ${sql.raw(alias)} on true`;
}

/**
 * 선택 화면이 그리는 시도 묶음이다. 계층을 만드는 자리는 여기 하나뿐이다.
 *
 * `앞 두 자리 + '000'`이 그 시도의 `전체` 코드라는 것은 **이 체계 하나의 소스 형식 사실**이다
 * (`15000 경남/전체`, `15653 경남/김해시`). 다른 체계로 옮겨 쓰지 않는다 — 특히 eaT `SGG_CD`의 뒤 세
 * 자리를 시군구 코드로 읽는 것은 ADR 0035가 이미 기각했다(같은 코드가 여러 이름을 갖는다). 여기서 자른
 * 문자열은 같은 체계의 `code_value`로 되돌려지고, 화면과 저장은 그 결과의 **숫자 id만** 쓴다. 문자열이
 * 키가 되는 자리는 이 질의 안에서 끝난다(AGENTS 2).
 *
 * 라벨이 관측되지 않은 코드도 감춘다면 그 코드로 제한된 공고를 아무도 고를 수 없게 된다. 실측 186개 중
 * 2개가 그 상태이므로 목록에 남기고 화면이 코드 문자열로 부른다(AGENTS 3).
 */
export function eligibilityAreaCatalogQuery(): SQL {
  return sql`
    with ${eligibilityAreaCodeCte()}
    select whole.code_value_id::text as all_code_value_id,
           whole.code as all_code,
           whole.scheme as all_scheme,
           whole.label as all_label,
           coalesce((
             select json_agg(
                      json_build_object(
                        'code_value_id', part.code_value_id::text,
                        'code', part.code,
                        'scheme', part.scheme,
                        'label', part.label
                      ) order by part.code
                    )
               from eligibility_area_code part
              where part.sido_prefix = whole.sido_prefix
                and part.code_value_id <> whole.code_value_id
           ), '[]'::json) as parts
      from eligibility_area_code whole
     where whole.code = whole.sido_prefix || '000'
     order by whole.code
  `;
}
