/** @module 책임: 적용된 비교조건을 조건 사전 operation query로 옮기고 transport 독립 조회를 수행한다. */
import {
  analysisV1Operations,
  type AnalysisConditionOptionsV1Response,
  type AnalysisFilterValue,
  type OperationQueryInput
} from '@eatbid/contracts/api/v1/analysis';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAnalysisResourceError } from './analysis-resource-error';
import { analysisTimeSeriesQueryOf } from './find-analysis-time-series';

export type AnalysisConditionOptionsQueryInput = OperationQueryInput<
  typeof analysisV1Operations.findConditionOptions
>;

/**
 * 조건 사전은 그림과 **같은 조건**을 물어야 한다. 그래서 시간축 query를 그대로 만들고 화면이 지금 펼친
 * 자리(고른 시도, 적고 있는 검색어)만 더 얹는다 — 조건을 여기서 다시 적으면 조건 막대의 건수와 그림의
 * 표본 수가 서로 다른 집합을 세게 된다.
 */
export function analysisConditionOptionsQueryOf(
  filter: AnalysisFilterValue,
  open: { readonly sido: string | null; readonly organizationQuery: string | null }
): AnalysisConditionOptionsQueryInput {
  return {
    ...analysisTimeSeriesQueryOf(filter),
    ...(open.sido === null ? {} : { sido: open.sido }),
    ...(open.organizationQuery === null ? {} : { organizationQuery: open.organizationQuery })
  };
}

export async function findAnalysisConditionOptionsWith(
  request: ContractRequest,
  input: AnalysisConditionOptionsQueryInput & { readonly signal?: AbortSignal }
): Promise<AnalysisConditionOptionsV1Response> {
  const { signal, ...condition } = input;
  const query = analysisV1Operations.findConditionOptions.querySchema.parse(condition);
  try {
    return await request({
      operation: analysisV1Operations.findConditionOptions,
      path: {},
      query,
      signal
    });
  } catch (error) {
    throw mapAnalysisResourceError(request, error);
  }
}
