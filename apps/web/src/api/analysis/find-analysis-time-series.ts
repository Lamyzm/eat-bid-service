/** @module 책임: 적용된 비교조건을 findAnalysisTimeSeries operation query로 옮기고 transport 독립 조회를 수행한다. */
import {
  analysisV1Operations,
  type AnalysisFilterValue,
  type AnalysisTimeSeriesV1Response,
  type OperationQueryInput
} from '@eatbid/contracts/api/v1/analysis';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAnalysisResourceError } from './analysis-resource-error';

/**
 * 요청 형태를 화면 어휘로 다시 적지 않고 계약 query의 입력 타입을 그대로 쓴다. 화면이 자기 이름으로
 * 조건을 한 번 더 정의하면 계약과 화면 중 어느 쪽이 모집단의 권위인지 알 수 없다.
 */
export type AnalysisTimeSeriesQueryInput = OperationQueryInput<
  typeof analysisV1Operations.findTimeSeries
>;

/**
 * 적용된 비교조건(`AnalysisFilterValue`)을 query로 옮긴다.
 *
 * 두 형태가 다른 이유는 각자의 자리가 다르기 때문이다. 필터 값은 주소에 실려 사용자의 선택을 그대로
 * 보존하는 중첩 구조이고, query는 평평한 문자열 쌍이다. null과 undefined의 뜻도 갈린다 — 필터의 null은
 * "이 경계를 두지 않는다"이고 query에서 그것은 키가 아예 없는 것이다. null을 그대로 보내면 계약이
 * `strictObject`로 끊는다.
 */
export function analysisTimeSeriesQueryOf(filter: AnalysisFilterValue): AnalysisTimeSeriesQueryInput {
  const scope = filter.comparisonScope;
  return {
    organizationId: filter.targetOrganizationId,
    ...(filter.excludeAttemptId === null ? {} : { excludeAttemptId: filter.excludeAttemptId }),
    from: filter.period.from,
    to: filter.period.to,
    dateBasis: filter.dateBasis,
    comparisonScope: scope.kind,
    ...(scope.kind === 'region'
      ? { comparisonRegionScheme: scope.scheme, comparisonRegionCodeValueId: scope.codeValueId }
      : {}),
    floorRate: filter.floorRate.value,
    awardMethodCodeValueId: filter.awardMethodCodeValueId,
    ...(filter.listCountRange.min === null ? {} : { listCountMin: filter.listCountRange.min }),
    ...(filter.listCountRange.max === null ? {} : { listCountMax: filter.listCountRange.max }),
    ...(filter.targetItemFilter.kind === 'code'
      ? { targetItemCodeValueId: filter.targetItemFilter.codeValueId }
      : {})
  };
}

export async function findAnalysisTimeSeriesWith(
  request: ContractRequest,
  input: AnalysisTimeSeriesQueryInput & { readonly signal?: AbortSignal }
): Promise<AnalysisTimeSeriesV1Response> {
  const { signal, ...condition } = input;
  // 모집단과 지역 축의 짝, 기간 상한, 명단 범위 순서는 계약이 여기서 끊는다. 무효 요청을 서버까지
  // 보내면 400 왕복이 화면의 정상 흐름이 된다.
  const query = analysisV1Operations.findTimeSeries.querySchema.parse(condition);
  try {
    return await request({
      operation: analysisV1Operations.findTimeSeries,
      path: {},
      query,
      signal
    });
  } catch (error) {
    throw mapAnalysisResourceError(request, error);
  }
}
