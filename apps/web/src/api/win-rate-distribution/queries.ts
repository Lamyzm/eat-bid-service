/** @module 책임: 낙찰률 분포 resource의 query key 계층과 AbortSignal 전달 queryOptions를 함께 소유한다. */
import { queryOptions } from '@tanstack/react-query';
import { winRateDistributionV1Operations } from '@eatbid/contracts/api/v1/win-rate-distribution';

import type { ContractRequest } from '../_transport/request-contract';
import {
  findWinRateDistributionWith,
  type WinRateDistributionCohort
} from './find-win-rate-distribution';

type ParsedCohort = ReturnType<typeof winRateDistributionV1Operations.find.querySchema.parse>;

// key에 코호트 전부(모집단·축·하한율·낙찰방식·기간·칸 폭·집계 단위)를 담는다. 하나라도 빠지면
// 조건을 바꿨는데 이전 사다리가 그대로 남는다.
const winRateDistributionQueryKeys = {
  all: () => ['win-rate-distribution'] as const,
  cohort: (query: ParsedCohort) => [...winRateDistributionQueryKeys.all(), query] as const
};

export function createWinRateDistributionQueries(request: ContractRequest) {
  return {
    all: winRateDistributionQueryKeys.all,
    distribution(input: WinRateDistributionCohort) {
      const query = winRateDistributionV1Operations.find.querySchema.parse(input);
      return queryOptions({
        queryKey: winRateDistributionQueryKeys.cohort(query),
        queryFn: ({ signal }) => findWinRateDistributionWith(request, { ...query, signal })
      });
    }
  };
}
