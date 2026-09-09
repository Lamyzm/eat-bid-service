/** @module 책임: RSC에서만 쓰는 기관 ID 검증과 캐시된·캐시 없는 회차 이력 조회를 예상된 실패(build 전환·사라진 cursor)까지 결과 값으로 돌려주는 표면을 제공한다. */
import 'server-only';

import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';
import { cacheLife, cacheTag } from 'next/cache';

import { READ_CACHE_LIFE } from '@/shared/lib/read-cache-life';

import { serverRequest } from '../_transport/server-request.server';
import { organizationAttemptsReadCacheTags } from './cache-tags';
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
 * 예상된 실패는 값이다. `use cache` 경계를 넘는 예외는 class 정체성을 잃어 호출자가 409와 400을 가릴 수
 * 없다(apps/web AGENTS). build 전환은 누적 목록 전체를 버려야 하는 사실이라 부분 성공으로 위장하지 않는다.
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
 * 캐시 경계다. 모든 조회 조건이 캐시 키가 되며 `signal`은 직렬화되지 않으므로 여기서 받지 않는다.
 * 태그는 응답 계보가 아니라 요청한 기관과 mart 이름에서만 파생한다 — 읽은 build id로는 다음 build를
 * 활성화한 쪽이 그 항목을 지울 수 없다(ADR 0036).
 */
export async function listOrganizationAuctionAttemptsFromServer(input: AttemptsReadInput): Promise<OrganizationAttemptsRead> {
  'use cache';
  cacheTag(...organizationAttemptsReadCacheTags(input.organizationId));
  cacheLife(READ_CACHE_LIFE);
  return await readAttempts(() => listOrganizationAuctionAttemptsWith(serverRequest, input));
}

/**
 * `historyRead=latest`의 uncached entry다. `use cache` 밖의 fetch는 Next가 캐시하지 않으므로(cacheComponents)
 * 부를 때마다 Nest를 다시 부른다. 쿠키를 읽지 않고 공유 캐시에도 쓰지 않는다. 비용이 있으니 build 전환
 * 복구 경로에서만 쓰고 기본 진입은 위 cached entry다. 바깥 `use cache`를 호출한 채 안쪽만 바꾸면 stale은
 * 그대로라 entry 자체를 나눈다.
 */
export async function listOrganizationAuctionAttemptsFromServerLatest(input: AttemptsReadInput): Promise<OrganizationAttemptsRead> {
  return await readAttempts(() => listOrganizationAuctionAttemptsWith(serverRequest, input));
}

export { isOrganizationCursorInvalidError, isOrganizationNotFoundError };
export { revalidateOrgRoundSummaryCache } from './revalidate';
