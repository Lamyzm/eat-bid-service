/** @module 책임: 조건 사전 조회의 query key 계층과 AbortSignal 전달 queryOptions를 소유한다. */
import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query';

import type { ContractRequest } from '../_transport/request-contract';
import {
  findAnalysisConditionOptionsWith,
  type AnalysisConditionOptionsQueryInput
} from './find-analysis-condition-options';

const analysisQueryKeys = {
  all: () => ['analysis'] as const,
  conditionOptions: (query: AnalysisConditionOptionsQueryInput | null) =>
    [...analysisQueryKeys.all(), 'condition-options', query] as const
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
        queryFn: input === null
          ? skipToken
          : ({ signal }) => findAnalysisConditionOptionsWith(request, { ...input, signal }),
        /*
         * 조건을 바꾸면 건수가 다시 필요하지만, 그동안 목록을 비우면 펼쳐 놓은 여닫이가 한 번 비었다
         * 다시 차면서 누르려던 줄이 사라진다. 옛 건수를 잠깐 더 보여 주는 쪽이 목록이 통째로
         * 깜빡이는 것보다 낫다 — 건수는 판단의 보조이고 고르는 일 자체를 막으면 안 된다.
         */
        placeholderData: keepPreviousData
      });
    }
  };
}
