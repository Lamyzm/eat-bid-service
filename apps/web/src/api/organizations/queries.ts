/** @module 책임: 기관 회차 이력 resource의 query key 계층과 AbortSignal 전달 queryOptions를 함께 소유한다. */
import { queryOptions } from '@tanstack/react-query';
import {
  organizationV1Operations,
  type OrganizationAttemptOpenedFilter
} from '@eatbid/contracts/api/v1/organizations';

import type { ContractRequest } from '../_transport/request-contract';
import { listOrganizationAuctionAttemptsWith } from './list-auction-attempts';

const organizationQueryKeys = {
  all: () => ['organizations'] as const,
  attemptsLists: () => [...organizationQueryKeys.all(), 'attempts'] as const,
  attemptsList: (
    organizationId: string,
    // 개찰 필터가 key에 없으면 only·any 응답이 같은 cache 항목을 덮어쓴다.
    query: {
      readonly item?: string;
      readonly cursor?: string;
      readonly limit: number;
      readonly opened: OrganizationAttemptOpenedFilter;
    }
  ) => [...organizationQueryKeys.attemptsLists(), organizationId, query] as const
};

export function createOrganizationQueries(request: ContractRequest) {
  return {
    all: organizationQueryKeys.all,
    attemptsLists: organizationQueryKeys.attemptsLists,
    attempts(input: {
      readonly organizationId: string;
      readonly item?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }) {
      const path = organizationV1Operations.listAuctionAttempts.pathSchema.parse({
        organizationId: input.organizationId
      });
      const query = organizationV1Operations.listAuctionAttempts.querySchema.parse({
        item: input.item,
        cursor: input.cursor,
        limit: input.limit
      });
      return queryOptions({
        queryKey: organizationQueryKeys.attemptsList(path.organizationId, query),
        queryFn: ({ signal }) =>
          listOrganizationAuctionAttemptsWith(request, {
            organizationId: path.organizationId,
            item: query.item,
            cursor: query.cursor,
            limit: query.limit,
            signal
          })
      });
    }
  };
}
