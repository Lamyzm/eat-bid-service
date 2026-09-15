/** @module 책임: 계정 query key 계층을 principal·workspace로 격리하고 계정 전환·로그아웃의 개인 캐시 폐기를 소유한다. */
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import type { ContractRequest } from '../_transport/request-contract';
import {
  isAccountForbiddenError,
  isAccountUnauthenticatedError,
  isBidObservationsBuildChangedError,
  isBidObservationsLineageError
} from './account-resource-error';
import {
  bidObservationsIdentity,
  findMyBidObservationsWith,
  type MyBidObservationsInput
} from './find-my-bid-observations';
import { getCurrentSessionWith } from './get-current-session';
import { listMyBusinessesWith } from './my-businesses';
import { listFilterCombinationsWith } from './filter-combinations';
import { getMyRegionPreferenceWith } from './region-preference';

/**
 * 세션 조회는 principal을 아직 모르는 상태의 답이므로 개인 하위 트리 밖에 둔다. 그 아래의 개인 자료는
 * principal과 workspace를 key에 담아 다른 계정이 같은 URL에서 앞 사람의 응답을 재사용하지 못하게 한다
 * (ADR 0032 §9). key가 같으면 캐시가 같다는 사실이 여기서 유일한 방어다.
 */
export const accountQueryKeys = {
  all: () => ['account'] as const,
  sessionRoot: () => [...accountQueryKeys.all(), 'session'] as const,
  session: (subject: string | null) => [...accountQueryKeys.sessionRoot(), subject] as const,
  privateRoot: () => [...accountQueryKeys.all(), 'private'] as const,
  workspace: (principalId: string, workspaceId: string) =>
    [...accountQueryKeys.privateRoot(), principalId, workspaceId] as const,
  businesses: (principalId: string, workspaceId: string) =>
    [...accountQueryKeys.workspace(principalId, workspaceId), 'businesses'] as const,
  regionPreference: (principalId: string, workspaceId: string) =>
    [...accountQueryKeys.workspace(principalId, workspaceId), 'region-preference'] as const,
  filterCombinations: (principalId: string, workspaceId: string) =>
    [...accountQueryKeys.workspace(principalId, workspaceId), 'filter-combinations'] as const,
  bidObservations: (
    principalId: string,
    workspaceId: string,
    businessId: string,
    organizationId: string,
    buildId: string,
    attempts: string
  ) =>
    [
      ...accountQueryKeys.workspace(principalId, workspaceId),
      'bid-observations',
      businessId,
      organizationId,
      buildId,
      attempts
    ] as const
};

export interface PrivateWorkspaceScope {
  readonly principalId: string;
  readonly workspaceId: string;
}

export function createAccountQueries(request: ContractRequest) {
  return {
    all: accountQueryKeys.all,
    privateRoot: accountQueryKeys.privateRoot,
    sessionRoot: accountQueryKeys.sessionRoot,
    /**
     * 세션 응답은 브라우저가 보낼 쿠키의 주체마다 다른 답이므로 그 주체를 key의 마지막 자리에 담는다.
     * 다른 탭의 로그아웃·로그인으로 주체가 바뀌면 캐시 항목 자체가 달라져, 새 계정의 화면이 이전 계정의
     * 답을 한순간도 읽지 않고 늦게 도착한 이전 계정의 응답도 새 화면에 닿지 못한다. 이 값은 전환 감지
     * marker이며 app principal과 워크스페이스의 권위는 응답 union이 그대로 소유한다(ADR 0032 §9).
     *
     * 주체를 아직 관측하지 못한 동안(`undefined`)에는 묻지 않는다. 그때 받은 답은 어느 주체의 것인지
     * 말할 수 없고, 관측 뒤에 다시 물으면 화면을 열 때마다 세션을 두 번 묻게 된다.
     */
    session(subject: string | null | undefined) {
      return queryOptions({
        queryKey: accountQueryKeys.session(subject ?? null),
        queryFn: ({ signal }) => getCurrentSessionWith(request, { signal }),
        enabled: subject !== undefined
      });
    },
    businesses(scope: PrivateWorkspaceScope) {
      return queryOptions({
        queryKey: accountQueryKeys.businesses(scope.principalId, scope.workspaceId),
        queryFn: ({ signal }) => listMyBusinessesWith(request, { signal })
      });
    },
    /** 개인 하위 트리 아래라 계정 전환·로그아웃의 폐기가 그대로 적용된다. */
    regionPreference(scope: PrivateWorkspaceScope) {
      return queryOptions({
        queryKey: accountQueryKeys.regionPreference(scope.principalId, scope.workspaceId),
        queryFn: ({ signal }) => getMyRegionPreferenceWith(request, { signal })
      });
    },
    /**
     * 저장된 조합이다. 건수는 여기 없다 — 건수는 지금 화면 조건에 따라 달라지는 파생값이라 조합 목록과
     * 같은 캐시 항목에 두면 조건을 바꿀 때마다 목록까지 함께 버려진다.
     */
    filterCombinations(scope: PrivateWorkspaceScope) {
      return queryOptions({
        queryKey: accountQueryKeys.filterCombinations(scope.principalId, scope.workspaceId),
        queryFn: ({ signal }) => listFilterCombinationsWith(request, { signal })
      });
    },
    /**
     * 개인 하위 트리 아래라 계정 전환·로그아웃의 폐기가 그대로 적용된다. build·회차 집합이 key라 build 전환
     * 뒤 옛 응답을 새 표 위에 겹칠 수 없고, 늦게 도착한 이전 build 응답은 이미 버린 항목에만 닿는다.
     */
    bidObservations(scope: PrivateWorkspaceScope, input: Omit<MyBidObservationsInput, 'signal'>) {
      return queryOptions({
        queryKey: accountQueryKeys.bidObservations(
          scope.principalId,
          scope.workspaceId,
          input.businessId,
          input.organizationId,
          input.buildId,
          bidObservationsIdentity(input.attempts)
        ),
        queryFn: ({ signal }) => findMyBidObservationsWith(request, { ...input, signal }),
        // 전환·권한·계보 오류는 재시도로 풀리지 않는다. 자동 재시도가 복구 안내를 몇 초 늦추면 안 된다.
        retry: (count, error) =>
          count < 1 &&
          !isBidObservationsBuildChangedError(error) &&
          !isBidObservationsLineageError(error) &&
          !isAccountUnauthenticatedError(error) &&
          !isAccountForbiddenError(error)
      });
    }
  };
}

/**
 * 로그아웃에서 부른다. 진행 중인 요청을 먼저 끊지 않으면 이미 떠난 계정의 응답이 도착해 캐시를 다시
 * 채운다. 세션 답도 함께 버린다. 남겨 두면 provider 상태가 화면에 닿기까지 이전 계정의 이름과
 * 워크스페이스가 계속 보이고, 그 사이의 새로고침 한 번이 남의 화면이 된다.
 */
export async function discardAccountCache(client: QueryClient): Promise<void> {
  const queryKey = accountQueryKeys.all();
  await client.cancelQueries({ queryKey });
  client.removeQueries({ queryKey });
}

/**
 * 전환 뒤 현재 주체의 답만 남긴다. 이전 주체의 세션 요청이 아직 떠 있으면 끊고, 이미 받은 답은 버려
 * 다음 전환에서 그 항목이 다시 읽히지 않게 한다.
 */
export async function discardOtherSubjects(
  client: QueryClient,
  subject: string | null
): Promise<void> {
  const queryKey = accountQueryKeys.sessionRoot();
  const predicate = (query: { readonly queryKey: readonly unknown[] }) =>
    query.queryKey[2] !== subject;
  await client.cancelQueries({ queryKey, predicate });
  client.removeQueries({ queryKey, predicate });
}

/**
 * 같은 브라우저에서 계정이 바뀌었을 때 이전 principal의 개인 캐시만 버린다. 새 계정의 화면이 앞 사람의
 * 사업장 주소나 번호를 한순간도 보여 주지 않게 하는 것이 이 함수의 목적이다.
 */
export async function discardOtherPrincipals(
  client: QueryClient,
  principalId: string | null
): Promise<void> {
  const queryKey = accountQueryKeys.privateRoot();
  const predicate = (query: { readonly queryKey: readonly unknown[] }) =>
    query.queryKey[2] !== principalId;
  await client.cancelQueries({ queryKey, predicate });
  client.removeQueries({ queryKey, predicate });
}
