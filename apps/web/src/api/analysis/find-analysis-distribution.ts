/** @module 책임: 적용된 비교조건을 findAnalysisDistribution operation query로 옮기고 transport 독립 조회를 수행한다. */
import {
  analysisV1Operations,
  type AnalysisDistributionV1Response
} from '@eatbid/contracts/api/v1/analysis';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAnalysisResourceError } from './analysis-resource-error';
import type { AnalysisTimeSeriesQueryInput } from './find-analysis-time-series';

/**
 * 분포는 시간축과 **같은 query**를 받는다. 조건 변환을 따로 두면 두 그림이 다른 코호트를 말한다.
 */
export async function findAnalysisDistributionWith(
  request: ContractRequest,
  input: AnalysisTimeSeriesQueryInput & { readonly signal?: AbortSignal }
): Promise<AnalysisDistributionV1Response> {
  const { signal, ...condition } = input;
  const query = analysisV1Operations.findDistribution.querySchema.parse(condition);
  try {
    return await request({
      operation: analysisV1Operations.findDistribution,
      path: {},
      query,
      signal
    });
  } catch (error) {
    throw mapAnalysisResourceError(request, error);
  }
}
