/** @module 책임: 조건 막대가 지금 펼친 자리(시도·검색어)로 조건 사전을 조회하고 없는 동안의 상태를 준다. */
'use client';
import { useQuery } from '@tanstack/react-query';
import type { AnalysisFilterValue } from '@eatbid/contracts/api/v1/analysis';
import {
  analysisConditionOptionsQueryOf,
  analysisQueries,
  type AnalysisConditionOptionsV1Response
} from '@/api/analysis';

/**
 * 조건 사전은 **적용된 조건**으로 묻는다. 편집 중인 초안으로 물으면 화면이 아직 적용하지 않은 조건의
 * 건수를 말하게 되고, 그 수를 보고 고른 사용자는 다른 집합을 보게 된다. 조건은 고르는 즉시 적용되므로
 * 둘의 간격은 한 번의 왕복뿐이다.
 *
 * 조건이 무효하면 묻지 않는다(`skipToken`). 빈 문자열 키로 조회를 만들면 그 실패가 화면의 정상 흐름이
 * 된다.
 */
export function useConditionOptions(
  filter: AnalysisFilterValue | null,
  open: { readonly sido: string | null; readonly organizationQuery: string | null }
): {
  readonly options: AnalysisConditionOptionsV1Response | null;
  readonly loading: boolean;
} {
  const input = filter === null ? null : analysisConditionOptionsQueryOf(filter, open);
  const query = useQuery(analysisQueries.conditionOptions(input));
  return { options: query.data ?? null, loading: query.isPending && input !== null };
}
