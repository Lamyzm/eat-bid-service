/** @module 책임: RSC에서만 쓰는 기관 ID 검증과 세션 쿠키를 실어 나르는 회차 이력 조회를 예상된 실패(build 전환·사라진 cursor)까지 결과 값으로 돌려주는 표면을 제공한다. */
import 'server-only';

import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { listOrganizationAuctionAttemptsWith, type OrganizationAttemptsReadInput } from './list-auction-attempts';
import {
  isOrganizationBuildChangedError,
  isOrganizationCursorInvalidError,
  isOrganizationNotFoundError
} from './organization-resource-error';

export function parseOrganizationId(organizationId: string): string {
  return organizationV1Operations.listAuctionAttempts.pathSchema.parse({ organizationId })
    .organizationId;
}

/**
 * 예상된 실패는 값이다. 이 union은 원래 `use cache` 경계를 넘는 예외가 class 정체성을 잃어 호출자가
 * 409와 400을 가릴 수 없는 문제를 피하려고 생겼다. 지금은 두 함수 모두 `use cache`를 쓰지 않지만
 * (아래 주석, EAT-165) 호출부가 이미 이 계약을 소비하므로 형태를 유지한다. build 전환은 누적 목록
 * 전체를 버려야 하는 사실이라 부분 성공으로 위장하지 않는다.
 */
export type OrganizationAttemptsRead =
  | { readonly kind: 'page'; readonly response: OrganizationAuctionAttemptsV1Response }
  | { readonly kind: 'build-changed' }
  | { readonly kind: 'cursor-not-found' };

type AttemptsReadInput = Omit<OrganizationAttemptsReadInput, 'signal'>;

async function readAttempts(read: () => Promise<OrganizationAuctionAttemptsV1Response>): Promise<OrganizationAttemptsRead> {
  try {
    return { kind: 'page', response: await read() };
  } catch (error) {
    if (isOrganizationBuildChangedError(error)) return { kind: 'build-changed' };
    if (isOrganizationCursorInvalidError(error)) return { kind: 'cursor-not-found' };
    throw error;
  }
}

/**
 * 이 조회는 `ProviderSessionGuard`가 걸린 제품 데이터 읽기다(ADR 0032 §12). `use cache` 경계 안에서는
 * 요청 쿠키를 읽을 수 없어(ADR 0028 §4) 게이트 앞에 익명으로 닿아 항상 401을 받는다 — EAT-165가 잡은
 * 장애가 이 함수였다. `use cache`·`cacheTag`·`cacheLife`를 모두 떼고 쿠키를 그대로 실어 나르는
 * `privateServerRequest`로 세션을 전달한다(ADR 0032 §14). `cache-tags.ts`의 태그 함수와 `revalidate.ts`는
 * 걷어내지 않았으니 그 파일에서 "왜 안 불리는지"를 확인할 수 있다.
 */
export async function listOrganizationAuctionAttemptsFromServer(input: AttemptsReadInput): Promise<OrganizationAttemptsRead> {
  return await readAttempts(() => listOrganizationAuctionAttemptsWith(privateServerRequest, input));
}

/**
 * `historyRead=latest`의 재조회 경로다. 캐시 경계가 없던 자리라 위 `use cache` 제거와 별개로 이미
 * `privateServerRequest`가 필요했다 — 예전 주석은 "쿠키를 읽지 않는다"고 적었지만 이 endpoint도 같은
 * `ProviderSessionGuard`가 걸려 있어(위 주석) 쿠키 없는 `serverRequest`로는 이 경로도 항상 401이었다
 * (EAT-165). 부를 때마다 Nest를 다시 부르는 비용이 있으니 build 전환 복구 경로에서만 쓰고 기본 진입은
 * 위 함수다.
 */
export async function listOrganizationAuctionAttemptsFromServerLatest(input: AttemptsReadInput): Promise<OrganizationAttemptsRead> {
  return await readAttempts(() => listOrganizationAuctionAttemptsWith(privateServerRequest, input));
}

export { isOrganizationCursorInvalidError, isOrganizationNotFoundError };
export { revalidateOrgRoundSummaryCache } from './revalidate';
