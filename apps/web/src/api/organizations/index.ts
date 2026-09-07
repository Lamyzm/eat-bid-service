/** @module 책임: browser consumer가 사용하는 기관 회차 이력 조회와 TanStack Query 공개 표면을 제공한다. */
import type { OrganizationAuctionAttemptsV1Response } from '@eatbid/contracts/api/v1/organizations';

import { browserRequest } from '../_transport/browser-request';
import { listOrganizationAuctionAttemptsWith, type OrganizationAttemptsReadInput } from './list-auction-attempts';
import { createOrganizationQueries } from './queries';

export type {
  OrganizationAuctionAttempt,
  OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

export function listOrganizationAuctionAttempts(input: OrganizationAttemptsReadInput): Promise<OrganizationAuctionAttemptsV1Response> {
  return listOrganizationAuctionAttemptsWith(browserRequest, input);
}

export const organizationQueries = createOrganizationQueries(browserRequest);
