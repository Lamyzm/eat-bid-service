/** @module 책임: 참가제한지역 목록·미리보기 query key 계층과 선택 집합의 정체성 계산을 소유한다. */
import { queryOptions } from '@tanstack/react-query';

import type { ContractRequest } from '../_transport/request-contract';
import { listEligibilityAreasWith } from './list-eligibility-areas';
import { previewRegionCoverageWith } from './preview-region-coverage';

/**
 * 목록은 워크스페이스와 무관한 참조 자료라 개인 하위 트리 밖에 둔다. 미리보기는 아직 저장하지 않은
 * 선택이 곧 질문이므로 그 선택 자체를 key의 마지막 자리에 담는다 — 선택이 바뀌었는데 같은 자리에 이전
 * 답이 남아 있으면 화면이 다른 선택의 숫자를 보여 준다.
 */
export const eligibilityAreaQueryKeys = {
  all: () => ['eligibility-areas'] as const,
  list: () => [...eligibilityAreaQueryKeys.all(), 'list'] as const,
  coverage: (selection: string) => [...eligibilityAreaQueryKeys.all(), 'coverage', selection] as const
};

/** 선택 집합의 정체성이다. 순서가 달라도 같은 질문이므로 정렬해 하나의 이름으로 접는다. */
export function regionSelectionIdentity(codeValueIds: readonly string[]): string {
  return [...codeValueIds].toSorted().join(',');
}

export function createEligibilityAreaQueries(request: ContractRequest) {
  return {
    list() {
      return queryOptions({
        queryKey: eligibilityAreaQueryKeys.list(),
        queryFn: ({ signal }) => listEligibilityAreasWith(request, { signal })
      });
    },
    coverage(codeValueIds: readonly string[]) {
      return queryOptions({
        queryKey: eligibilityAreaQueryKeys.coverage(regionSelectionIdentity(codeValueIds)),
        queryFn: ({ signal }) => previewRegionCoverageWith(request, { codeValueIds, signal })
      });
    }
  };
}
