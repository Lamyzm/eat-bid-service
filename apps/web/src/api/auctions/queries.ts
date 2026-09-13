/** @module 책임: 공고 resource와 열린 공고 목록의 query key 계층과 AbortSignal 전달 queryOptions를 함께 소유한다. */
import { queryOptions } from '@tanstack/react-query';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';
import { getAuctionWith } from './get-auction';
import { getAuctionRosterWith } from './get-auction-roster';
import { listOpenAuctionsWith, type OpenAuctionListInput } from './list-open-auctions';

const auctionQueryKeys = {
  all: () => ['auctions'] as const,
  details: () => [...auctionQueryKeys.all(), 'detail'] as const,
  detail: (auctionId: string) => [...auctionQueryKeys.details(), auctionId] as const,
  openLists: () => [...auctionQueryKeys.all(), 'open'] as const,
  // 정규화된 query(기본값 포함)를 key에 담아야 같은 필터를 다르게 적은 두 호출이 같은 cache 항목을 본다.
  openList: (query: ReturnType<typeof auctionV1Operations.listOpen.querySchema.parse>) =>
    [...auctionQueryKeys.openLists(), query] as const
};

export function createAuctionQueries(request: ContractRequest) {
  return {
    all: auctionQueryKeys.all,
    details: auctionQueryKeys.details,
    roster(auctionId: string, revisionId?: string) {
      const path = auctionV1Operations.roster.pathSchema.parse({ auctionId });
      const query = auctionV1Operations.roster.querySchema.parse({ revisionId });
      return queryOptions({
        queryKey: [...auctionQueryKeys.detail(path.auctionId), 'roster', query] as const,
        queryFn: ({ signal }) => getAuctionRosterWith(request, { auctionId: path.auctionId, ...query, signal })
      });
    },
    openLists: auctionQueryKeys.openLists,
    detail(auctionId: string) {
      const path = auctionV1Operations.find.pathSchema.parse({ auctionId });
      return queryOptions({
        queryKey: auctionQueryKeys.detail(path.auctionId),
        queryFn: ({ signal }) => getAuctionWith(request, { auctionId: path.auctionId, signal })
      });
    },
    open(input: OpenAuctionListInput) {
      const query = auctionV1Operations.listOpen.querySchema.parse({
        sido: input.sido,
        item: input.item,
        closesWithinHours: input.closesWithinHours,
        baseAmountMin: input.baseAmountMin,
        baseAmountMax: input.baseAmountMax,
        cursor: input.cursor,
        limit: input.limit
      });
      return queryOptions({
        queryKey: auctionQueryKeys.openList(query),
        queryFn: ({ signal }) => listOpenAuctionsWith(request, { ...query, signal })
      });
    }
  };
}
