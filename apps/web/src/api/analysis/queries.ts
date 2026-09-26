/** @module 책임: 분석 조회(조건 사전·전체 이력)의 query key 계층과 AbortSignal 전달 query 옵션을 소유한다. */
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  skipToken
} from '@tanstack/react-query';
import type {
  AnalysisHistoryPopulation,
  AnalysisHistoryV1Response
} from '@eatbid/contracts/api/v1/analysis';

import type { ContractRequest } from '../_transport/request-contract';
import {
  findAnalysisConditionOptionsWith,
  type AnalysisConditionOptionsQueryInput
} from './find-analysis-condition-options';
import { findAnalysisHistoryWith, type AnalysisHistoryCondition } from './find-analysis-history';

const analysisQueryKeys = {
  all: () => ['analysis'] as const,
  conditionOptions: (query: AnalysisConditionOptionsQueryInput | null) =>
    [...analysisQueryKeys.all(), 'condition-options', query] as const,
  history: (condition: AnalysisHistoryCondition, population: AnalysisHistoryPopulation) =>
    [...analysisQueryKeys.all(), 'history', condition, population] as const
};

export function createAnalysisQueries(request: ContractRequest) {
  return {
    all: analysisQueryKeys.all,
    /**
     * 조건 사전은 조건이 바뀔 때마다 다시 필요하다. 정규화한 query를 key에 담아 같은 조건을 다르게 적은
     * 두 호출이 같은 항목을 보게 한다. 목록을 펼칠 때마다 다시 묻지 않도록 캐시 판정을 TanStack에 맡긴다.
     */
    conditionOptions(input: AnalysisConditionOptionsQueryInput | null) {
      return queryOptions({
        queryKey: analysisQueryKeys.conditionOptions(input),
        // 조건이 무효하면 조회를 만들지 않는다. 빈 키로 요청을 열면 그 실패가 화면의 정상 흐름이 된다.
        queryFn:
          input === null
            ? skipToken
            : ({ signal }) => findAnalysisConditionOptionsWith(request, { ...input, signal }),
        /*
         * 조건을 바꾸면 건수가 다시 필요하지만, 그동안 목록을 비우면 펼쳐 놓은 여닫이가 한 번 비었다
         * 다시 차면서 누르려던 줄이 사라진다. 옛 건수를 잠깐 더 보여 주는 쪽이 목록이 통째로
         * 깜빡이는 것보다 낫다 — 건수는 판단의 보조이고 고르는 일 자체를 막으면 안 된다.
         */
        placeholderData: keepPreviousData
      });
    },
    /**
     * 전체 이력은 스크롤하며 이어 읽는다. 다음 페이지는 **첫 페이지의 build**를 되돌려 보낸다 — 페이지마다
     * 그 순간의 활성 build를 읽으면 사이에 build가 바뀌어 같은 회차가 두 번 나오거나 빠진다. build가 바뀌면
     * 서버가 409로 거절하고, 화면은 처음부터 다시 읽는다.
     */
    history(condition: AnalysisHistoryCondition, population: AnalysisHistoryPopulation) {
      return infiniteQueryOptions({
        queryKey: analysisQueryKeys.history(condition, population),
        initialPageParam: null as {
          readonly cursor: string;
          readonly buildId: string | null;
        } | null,
        queryFn: ({ pageParam, signal }) =>
          findAnalysisHistoryWith(request, {
            condition,
            population,
            cursor: pageParam?.cursor ?? null,
            expectedBuildId: pageParam?.buildId ?? null,
            signal
          }),
        getNextPageParam: (last: AnalysisHistoryV1Response) =>
          last.nextCursor === null
            ? undefined
            : { cursor: last.nextCursor, buildId: last.meta.build.buildId }
      });
    }
  };
}
