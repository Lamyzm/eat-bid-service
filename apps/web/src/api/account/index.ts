/** @module 책임: browser consumer가 쓰는 세션·등록 사업자 조회와 command, TanStack Query 공개 표면을 제공한다. */
import type {
  MyBidObservationsV1Response,
  MyBusinessesV1Response,
  MyBusinessV1Response,
  MyFilterCombinationV1Response,
  AccountInitializationV1Response
} from '@eatbid/contracts/api/v1/me';
import type { MyRegionPreferenceV1Response } from '@eatbid/contracts/api/v1/me';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

import { browserRequest } from '../_transport/browser-request';
import { findMyBidObservationsWith, type MyBidObservationsInput } from './find-my-bid-observations';
import { getCurrentSessionWith } from './get-current-session';
import { initializeCurrentAccountWith } from './initialize-account';
import {
  clearMyBusinessLocationWith,
  listMyBusinessesWith,
  registerMyBusinessWith,
  setMyBusinessLocationWith
} from './my-businesses';
import {
  deleteFilterCombinationWith,
  saveFilterCombinationWith,
  type SaveFilterCombinationInput
} from './filter-combinations';
import { createAccountQueries } from './queries';
import { putMyRegionPreferenceWith } from './region-preference';

export type {
  AccountLabel,
  CurrentSessionV1Response
} from '@eatbid/contracts/api/v1/session';
export type {
  BidObservationAttemptKey,
  MyAttemptBidObservation,
  MyBidObservationsV1Response,
  MyBidSubmission,
  MyBusinessesV1Response,
  MyBusinessV1Response,
  MyFilterCombinationsV1Response,
  MyFilterCombinationV1Response,
  MyRegionPreferenceV1Response,
  RegisteredBusiness,
  RegisteredBusinessLocation,
  WorkspaceRegionPreference
} from '@eatbid/contracts/api/v1/me';
export type { MyBidObservationsInput } from './find-my-bid-observations';
export type { FilterCombinationCountsInput, SaveFilterCombinationInput } from './filter-combinations';
export type { PrivateWorkspaceScope } from './queries';
export { discardAccountCache, discardOtherPrincipals, discardOtherSubjects } from './queries';
export {
  isAccountDependencyUnavailableError,
  isAccountForbiddenError,
  isAccountUnauthenticatedError,
  isBidObservationsBuildChangedError,
  isBidObservationsLineageError,
  isBidObservationsRejectedError,
  isBusinessNumberRejectedError,
  isRegisteredBusinessConflictError,
  isRegisteredBusinessMissingError
} from './account-resource-error';

export function findMyBidObservations(input: MyBidObservationsInput): Promise<MyBidObservationsV1Response> {
  return findMyBidObservationsWith(browserRequest, input);
}

export function getCurrentSession(input: {
  readonly signal?: AbortSignal;
} = {}): Promise<CurrentSessionV1Response> {
  return getCurrentSessionWith(browserRequest, input);
}

export function initializeCurrentAccount(input: {
  readonly signal?: AbortSignal;
} = {}): Promise<AccountInitializationV1Response> {
  return initializeCurrentAccountWith(browserRequest, input);
}

export function listMyBusinesses(input: {
  readonly signal?: AbortSignal;
} = {}): Promise<MyBusinessesV1Response> {
  return listMyBusinessesWith(browserRequest, input);
}

export function registerMyBusiness(input: {
  readonly businessNumber: string;
  readonly signal?: AbortSignal;
}): Promise<MyBusinessV1Response> {
  return registerMyBusinessWith(browserRequest, input);
}

export function setMyBusinessLocation(input: {
  readonly businessId: string;
  readonly addressText: string;
  readonly signal?: AbortSignal;
}): Promise<MyBusinessV1Response> {
  return setMyBusinessLocationWith(browserRequest, input);
}

export function clearMyBusinessLocation(input: {
  readonly businessId: string;
  readonly signal?: AbortSignal;
}): Promise<MyBusinessV1Response> {
  return clearMyBusinessLocationWith(browserRequest, input);
}

export function putMyRegionPreference(input: {
  readonly codeValueIds: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<MyRegionPreferenceV1Response> {
  return putMyRegionPreferenceWith(browserRequest, input);
}

export const accountQueries = createAccountQueries(browserRequest);

/**
 * 조합 저장과 삭제다. 상한 초과와 이름 중복은 409로 오며 화면이 둘을 다른 문구로 안내한다 — 둘 다
 * 잘못된 요청이 아니라 지금 저장 상태와의 충돌이라 사용자가 할 일이 다르다.
 */
export function saveFilterCombination(input: SaveFilterCombinationInput): Promise<MyFilterCombinationV1Response> {
  return saveFilterCombinationWith(browserRequest, input);
}

export function deleteFilterCombination(input: { readonly filterCombinationId: string }): Promise<void> {
  return deleteFilterCombinationWith(browserRequest, input);
}
