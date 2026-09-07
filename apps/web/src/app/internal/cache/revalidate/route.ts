/** @module 책임: web 소유 캐시 무효화 operation을 resource 무효화 함수와 runtime 토큰에 조립한다. */
import { randomUUID } from 'node:crypto';

import { revalidateAuctionCache, revalidateOpenAuctionSnapshotCache } from '@/api/auctions/server';
import { revalidateOrgRoundSummaryCache } from '@/api/organizations/server';
import { revalidateWinRateDistributionCache } from '@/api/win-rate-distribution/server';

import { dispatchRevalidate } from './_dispatch';

export async function POST(request: Request): Promise<Response> {
  // 토큰은 module load가 아니라 매 요청 시점에 읽는다. 배포 runtime 주입과 test 격리를 위해
  // `server-request.server.ts`가 origin에 대해 하는 것과 같은 규칙이다.
  return await dispatchRevalidate({
    request,
    expectedToken: process.env.EATBID_CACHE_REVALIDATE_TOKEN,
    revalidators: {
      auctions: revalidateAuctionCache,
      orgRoundSummary: revalidateOrgRoundSummaryCache,
      winRateDistributionMonthly: revalidateWinRateDistributionCache,
      openAuctionSnapshot: revalidateOpenAuctionSnapshotCache
    },
    requestId: randomUUID()
  });
}
