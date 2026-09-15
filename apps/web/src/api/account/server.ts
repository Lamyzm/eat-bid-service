/**
 * @module 책임: RSC가 요청 쿠키로 읽는 세션·등록 사업자 조회를 요청 범위 안에서 한 번만 수행하고,
 * 브라우저 캐시가 그 답을 이어받을 query key까지 같은 자리에서 내준다.
 */
import 'server-only';

import type {
  MyBusinessesV1Response,
  MyFilterCombinationCountsV1Response,
  MyRegionPreferenceV1Response
} from '@eatbid/contracts/api/v1/me';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';
import { cache } from 'react';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { getCurrentSessionWith } from './get-current-session';
import { listMyBusinessesWith } from './my-businesses';
import { countFilterCombinationsWith, type FilterCombinationCountsInput } from './filter-combinations';
import { getMyRegionPreferenceWith } from './region-preference';
import { isAccountDependencyUnavailableError } from './account-resource-error';
import { accountQueryKeys, type PrivateWorkspaceScope } from './queries';

/**
 * 세션 의존 조회에는 `use cache`를 두지 않는다. 이 응답은 쿠키마다 다르고 캐시 경계 안에서는 쿠키를
 * 읽을 수조차 없다(ADR 0028 §4, ADR 0032 §1). 요청 하나 안에서 여러 컴포넌트가 같은 답을 필요로 하면
 * `React.cache`로 요청 범위 안에서만 공유한다.
 */
export type CurrentSessionRead =
  | { readonly kind: 'session'; readonly response: CurrentSessionV1Response }
  | { readonly kind: 'auth-unavailable' };

/**
 * 인증 의존성이 없는 배포는 예외가 아니라 화면이 말해야 하는 상태다. 여기서 던지면 진입 화면이
 * "로그인하면 된다"가 아니라 error 경계를 렌더한다.
 *
 * 요청 범위 memo를 두는 이유는 같은 요청 안에 이 답을 필요로 하는 자리가 둘 이상이기 때문이다. 업무
 * layout은 게이트 판정에, 계정 슬롯은 브라우저에 넘길 첫 값에 같은 답을 쓴다. memo가 없으면 화면 하나를
 * 여는 데 세션 계약 조회가 그 자리 수만큼 늘어난다.
 */
export const getCurrentSessionFromServer = cache(
  async function getCurrentSessionFromServer(): Promise<CurrentSessionRead> {
    try {
      return { kind: 'session', response: await getCurrentSessionWith(privateServerRequest) };
    } catch (error) {
      if (isAccountDependencyUnavailableError(error)) return { kind: 'auth-unavailable' };
      throw error;
    }
  }
);

/**
 * 목록을 읽지 못한 것과 등록이 하나도 없는 것은 사용자가 할 일이 다르다. 실패를 빈 목록으로 바꾸면
 * 화면이 "아직 등록한 사업자가 없습니다"라고 거짓말한다. 서버가 못 읽었으면 넘길 값이 없다고만 말하고
 * 복구는 브라우저의 같은 조회가 자기 실패 상태로 안내한다.
 */
export type MyBusinessesRead =
  | { readonly kind: 'businesses'; readonly response: MyBusinessesV1Response }
  | { readonly kind: 'unread' };

export const listMyBusinessesFromServer = cache(async function listMyBusinessesFromServer(): Promise<MyBusinessesRead> {
  try {
    return { kind: 'businesses', response: await listMyBusinessesWith(privateServerRequest) };
  } catch {
    return { kind: 'unread' };
  }
});

/**
 * 관심 지역은 오늘 화면의 게이트 판정에 쓰인다. 읽지 못한 것과 확인하지 않은 것은 사용자가 할 일이
 * 다르므로 합치지 않는다 — 읽지 못했으면 목록을 좁힐 근거가 없고, 확인하지 않았으면 설정을 요청해야 한다.
 */
export type MyRegionPreferenceRead =
  | { readonly kind: 'preference'; readonly response: MyRegionPreferenceV1Response }
  | { readonly kind: 'unread' };

export const getMyRegionPreferenceFromServer = cache(
  async function getMyRegionPreferenceFromServer(): Promise<MyRegionPreferenceRead> {
    try {
      return { kind: 'preference', response: await getMyRegionPreferenceWith(privateServerRequest) };
    } catch {
      return { kind: 'unread' };
    }
  }
);

/**
 * 조합 건수는 못 읽어도 화면이 서야 한다. 조합은 탐색을 빠르게 하는 기둥이지 목록의 전제가 아니므로,
 * 못 읽으면 기둥만 비우고 목록은 그대로 낸다. 실패를 0건으로 바꾸지 않는 이유는 그러면 화면이 "저장한
 * 조합에 공고가 없다"고 거짓말하기 때문이다.
 */
export type FilterCombinationCountsRead =
  | { readonly kind: 'counts'; readonly response: MyFilterCombinationCountsV1Response }
  | { readonly kind: 'unread' };

export async function countFilterCombinationsFromServer(
  input: FilterCombinationCountsInput
): Promise<FilterCombinationCountsRead> {
  try {
    return { kind: 'counts', response: await countFilterCombinationsWith(privateServerRequest, input) };
  } catch {
    return { kind: 'unread' };
  }
}

/**
 * 서버가 읽은 목록을 브라우저 캐시의 어느 자리에 놓을지는 조회를 소유한 query factory가 정한다. 여기서
 * key를 새로 적으면 등록·주소 변경 뒤의 무효화가 다른 자리를 지우게 되어 화면이 옛 목록에 머문다.
 */
export function myBusinessesCacheKey(scope: PrivateWorkspaceScope): readonly unknown[] {
  return accountQueryKeys.businesses(scope.principalId, scope.workspaceId);
}

export function myRegionPreferenceCacheKey(scope: PrivateWorkspaceScope): readonly unknown[] {
  return accountQueryKeys.regionPreference(scope.principalId, scope.workspaceId);
}
