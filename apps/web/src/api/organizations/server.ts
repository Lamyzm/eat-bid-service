/** @module 책임: RSC에서만 쓰는 기관 ID 검증·회차 이력 조회·오류 판별 표면을 제공한다. */
import 'server-only';

import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import { serverRequest } from '../_transport/server-request.server';
import { listOrganizationAuctionAttemptsWith } from './list-auction-attempts';
import { isOrganizationCursorInvalidError, isOrganizationNotFoundError } from './organization-resource-error';

export function parseOrganizationId(organizationId: string): string {
  return organizationV1Operations.listAuctionAttempts.pathSchema.parse({ organizationId })
    .organizationId;
}

export function listOrganizationAuctionAttemptsFromServer(input: {
  readonly organizationId: string;
  readonly item?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}): Promise<OrganizationAuctionAttemptsV1Response> {
  return listOrganizationAuctionAttemptsWith(serverRequest, input);
}

export { isOrganizationCursorInvalidError, isOrganizationNotFoundError };
