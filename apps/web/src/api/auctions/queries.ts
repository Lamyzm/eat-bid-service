/** @module 책임: 공고 resource의 query key 계층과 AbortSignal 전달 queryOptions를 함께 소유한다. */
import { queryOptions } from '@tanstack/react-query';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';
import { getAuctionWith } from './get-auction';

const auctionQueryKeys = {
  all: () => ['auctions'] as const,
  details: () => [...auctionQueryKeys.all(), 'detail'] as const,
  detail: (auctionId: string) => [...auctionQueryKeys.details(), auctionId] as const
};

export function createAuctionQueries(request: ContractRequest) {
  return {
    all: auctionQueryKeys.all,
    details: auctionQueryKeys.details,
    detail(auctionId: string) {
      const path = auctionV1Operations.find.pathSchema.parse({ auctionId });
      return queryOptions({
        queryKey: auctionQueryKeys.detail(path.auctionId),
        queryFn: ({ signal }) => getAuctionWith(request, { auctionId: path.auctionId, signal })
      });
    }
  };
}
