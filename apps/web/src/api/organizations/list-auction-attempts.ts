/** @module 책임: 기관 ID와 회차 조회 query를 organizations listAuctionAttempts operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import type { ContractRequest } from '../_transport/request-contract';
import { mapOrganizationResourceError } from './organization-resource-error';

export async function listOrganizationAuctionAttemptsWith(
  request: ContractRequest,
  input: {
    readonly organizationId: string;
    readonly item?: string;
    readonly cursor?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }
): Promise<OrganizationAuctionAttemptsV1Response> {
  const path = organizationV1Operations.listAuctionAttempts.pathSchema.parse({
    organizationId: input.organizationId
  });
  const query = organizationV1Operations.listAuctionAttempts.querySchema.parse({
    item: input.item,
    cursor: input.cursor,
    limit: input.limit
  });
  try {
    return await request({
      operation: organizationV1Operations.listAuctionAttempts,
      path,
      query,
      signal: input.signal
    });
  } catch (error) {
    throw mapOrganizationResourceError(request, error, {
      organizationId: path.organizationId,
      hasCursor: query.cursor !== undefined
    });
  }
}
