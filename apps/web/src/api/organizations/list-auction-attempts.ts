/** @module 책임: 기관 ID와 회차 조회 query를 organizations listAuctionAttempts operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsQuery,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import type { ContractRequest } from '../_transport/request-contract';
import { mapOrganizationResourceError } from './organization-resource-error';

/** operation query를 재사용해 필터가 wrapper마다 누락되거나 다른 의미로 정의되지 않게 한다. */
export interface OrganizationAttemptsReadInput extends OrganizationAuctionAttemptsQuery {
  readonly organizationId: string;
  readonly signal?: AbortSignal;
}

export async function listOrganizationAuctionAttemptsWith(
  request: ContractRequest,
  input: OrganizationAttemptsReadInput
): Promise<OrganizationAuctionAttemptsV1Response> {
  const { organizationId, signal, ...queryInput } = input;
  const path = organizationV1Operations.listAuctionAttempts.pathSchema.parse({
    organizationId
  });
  const query = organizationV1Operations.listAuctionAttempts.querySchema.parse(queryInput);
  try {
    return await request({
      operation: organizationV1Operations.listAuctionAttempts,
      path,
      query,
      signal
    });
  } catch (error) {
    throw mapOrganizationResourceError(request, error, {
      organizationId: path.organizationId,
      hasCursor: query.cursor !== undefined
    });
  }
}
