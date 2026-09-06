/** @module 책임: RSC에서만 쓰는 기관 ID 검증·캐시된 회차 이력 조회·오류 판별 표면을 제공한다. */
import 'server-only';

import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';
import { cacheLife, cacheTag } from 'next/cache';

import { READ_CACHE_LIFE } from '@/shared/lib/read-cache-life';

import { serverRequest } from '../_transport/server-request.server';
import { organizationAttemptsReadCacheTags } from './cache-tags';
import { listOrganizationAuctionAttemptsWith } from './list-auction-attempts';
import { isOrganizationCursorInvalidError, isOrganizationNotFoundError } from './organization-resource-error';

export function parseOrganizationId(organizationId: string): string {
  return organizationV1Operations.listAuctionAttempts.pathSchema.parse({ organizationId })
    .organizationId;
}

/**
 * 캐시 경계다. 네 입력값이 그대로 캐시 키가 되며 `signal`은 직렬화되지 않으므로 여기서 받지 않는다.
 * 태그는 응답 계보가 아니라 요청한 기관과 mart 이름에서만 파생한다 — 읽은 build id로는 다음 build를
 * 활성화한 쪽이 그 항목을 지울 수 없다(ADR 0036).
 */
export async function listOrganizationAuctionAttemptsFromServer(input: {
  readonly organizationId: string;
  readonly item?: string;
  readonly cursor?: string;
  readonly limit?: number;
}): Promise<OrganizationAuctionAttemptsV1Response> {
  'use cache';
  cacheTag(...organizationAttemptsReadCacheTags(input.organizationId));
  cacheLife(READ_CACHE_LIFE);
  return await listOrganizationAuctionAttemptsWith(serverRequest, input);
}

export { isOrganizationCursorInvalidError, isOrganizationNotFoundError };
