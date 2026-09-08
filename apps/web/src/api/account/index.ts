/** @module 책임: browser consumer가 쓰는 세션·등록 사업자 조회와 command, TanStack Query 공개 표면을 제공한다. */
import type {
  MyBusinessesV1Response,
  MyBusinessV1Response,
  AccountInitializationV1Response
} from '@eatbid/contracts/api/v1/me';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

import { browserRequest } from '../_transport/browser-request';
import { getCurrentSessionWith } from './get-current-session';
import { initializeCurrentAccountWith } from './initialize-account';
import {
  clearMyBusinessLocationWith,
  listMyBusinessesWith,
  registerMyBusinessWith,
  setMyBusinessLocationWith
} from './my-businesses';
import { createAccountQueries } from './queries';

export type {
  AccountLabel,
  CurrentSessionV1Response
} from '@eatbid/contracts/api/v1/session';
export type {
  MyBusinessesV1Response,
  MyBusinessV1Response,
  RegisteredBusiness,
  RegisteredBusinessLocation
} from '@eatbid/contracts/api/v1/me';
export type { PrivateWorkspaceScope } from './queries';
export { discardAccountCache, discardOtherPrincipals, discardOtherSubjects } from './queries';
export {
  isAccountDependencyUnavailableError,
  isAccountForbiddenError,
  isAccountUnauthenticatedError,
  isBusinessNumberRejectedError,
  isRegisteredBusinessConflictError,
  isRegisteredBusinessMissingError
} from './account-resource-error';

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

export const accountQueries = createAccountQueries(browserRequest);
