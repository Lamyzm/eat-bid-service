/** @module 책임: 공고 RSC route에서 params·searchParams 접근을 Suspense 안 loader로 격리하고 계약 조회 결과를 화면과 Next notFound 경계로 분기한다. */
import { systemClock } from '@eatbid/domain';
import { getAuctionFromServer, parseAuctionId } from '@/api/auctions/server';
import { listOrganizationAuctionAttemptsFromServer } from '@/api/organizations/server';
import { findWinRateDistributionFromServer } from '@/api/win-rate-distribution/server';
import { notFound } from 'next/navigation';
import { createLoader } from 'nuqs/server';
import { Suspense } from 'react';

import { decisionSearchParsers } from './_lib/decision-search-params';
import { loadAuctionPage } from './_model/load-auction-page';
import { DecisionScreen } from './_ui/decision-screen';
import { DecisionScreenSkeleton } from './_ui/decision-screen-skeleton';

type AuctionPageParams = PageProps<'/auctions/[auctionId]'>['params'];
type AuctionPageSearchParams = PageProps<'/auctions/[auctionId]'>['searchParams'];

const loadDecisionSearch = createLoader(decisionSearchParsers);

async function AuctionLoader({
  params,
  searchParams
}: {
  readonly params: AuctionPageParams;
  readonly searchParams: AuctionPageSearchParams;
}) {
  // history 조회가 URL의 item param을 필요로 하므로 search를 먼저 기다린 뒤 loader에 넘긴다.
  const search = await loadDecisionSearch(searchParams);
  const data = await loadAuctionPage(params, search, {
    parseAuctionId,
    getAuction: getAuctionFromServer,
    now: () => systemClock.now().toString(),
    listAttempts: listOrganizationAuctionAttemptsFromServer,
    findDistribution: findWinRateDistributionFromServer
  });

  if (!data) notFound();
  return (
    <DecisionScreen
      decision={data.decision}
      search={search}
      history={data.history}
      distribution={data.distribution}
    />
  );
}

// params·searchParams를 page 최상위에서 await하면 static shell이 사라진다(ADR 0028). promise를 Suspense
// 안 loader에 넘겨 shell은 prerender하고 공고 본문만 request 시점에 streaming한다. fallback은 loading.tsx와
// 같은 skeleton이다.
export default function AuctionPage({ params, searchParams }: PageProps<'/auctions/[auctionId]'>) {
  return (
    <Suspense fallback={<DecisionScreenSkeleton />}>
      <AuctionLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
