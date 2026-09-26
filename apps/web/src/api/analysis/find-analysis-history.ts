/** @module 책임: 적용된 비교조건·집단·페이지 위치를 findAnalysisHistory operation query로 옮기고 transport 독립 조회를 수행한다. */
import {
  analysisV1Operations,
  type AnalysisFilterValue,
  type AnalysisHistoryPopulation,
  type AnalysisHistoryV1Response
} from '@eatbid/contracts/api/v1/analysis';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAnalysisResourceError } from './analysis-resource-error';
import { analysisTimeSeriesQueryOf } from './find-analysis-time-series';

/**
 * 이력의 조건은 시간축과 **같은 변환**을 쓴다. 따로 옮기면 표의 행과 그림의 표본이 다른 집합이 된다.
 * 겹쳐 찍을 기관은 이력의 집합을 바꾸지 않으므로 빼고 보낸다 — 캐시 키가 그 선택마다 갈리지 않게 한다.
 */
export function analysisHistoryConditionOf(filter: AnalysisFilterValue) {
  const { overlayOrganizationIds: _overlay, ...condition } = analysisTimeSeriesQueryOf(filter);
  return condition;
}

export type AnalysisHistoryCondition = ReturnType<typeof analysisHistoryConditionOf>;

export interface AnalysisHistoryPageInput {
  readonly condition: AnalysisHistoryCondition;
  readonly population: AnalysisHistoryPopulation;
  /** 앞 페이지가 준 커서와 build다. 첫 페이지는 둘 다 없다. */
  readonly cursor: string | null;
  readonly expectedBuildId: string | null;
  readonly signal?: AbortSignal;
}

export async function findAnalysisHistoryWith(
  request: ContractRequest,
  input: AnalysisHistoryPageInput
): Promise<AnalysisHistoryV1Response> {
  const query = analysisV1Operations.findHistory.querySchema.parse({
    ...input.condition,
    population: input.population,
    ...(input.cursor === null ? {} : { cursor: input.cursor }),
    ...(input.expectedBuildId === null ? {} : { expectedBuildId: input.expectedBuildId })
  });
  try {
    return await request({
      operation: analysisV1Operations.findHistory,
      path: {},
      query,
      signal: input.signal
    });
  } catch (error) {
    throw mapAnalysisResourceError(request, error);
  }
}
