/** @module 책임: 공고 RSC route에서 params·searchParams 접근을 Suspense 안 loader로 격리하고 계약 조회 결과를 화면과 Next notFound 경계로 분기한다. */
import { systemClock } from '@eatbid/domain';
import { getAuctionFromServer, parseAuctionId } from '@/api/auctions/server';
import {
  listOrganizationAuctionAttemptsFromServer,
  listOrganizationAuctionAttemptsFromServerLatest
} from '@/api/organizations/server';
import { findWinRateDistributionFromServer } from '@/api/win-rate-distribution/server';
import { notFound } from 'next/navigation';
import { createLoader } from 'nuqs/server';
import { Suspense } from 'react';

import { decisionSearchParsers } from './_lib/decision-search-params';
import { loadAuctionPage } from './_model/load-auction-page';
import { DecisionScreen } from './_ui/decision-screen';
import { DecisionScreenSkeleton } from './_ui/decision-screen-skeleton';
import { OwnBidProvider } from './_ui/own-bid/own-bid-provider';

type AuctionPageProps = PageProps<'/auctions/[auctionId]'>;

const loadDecisionSearch = createLoader(decisionSearchParsers);

async function AuctionLoader({
  params,
  searchParams
}: {
  readonly params: AuctionPageProps['params'];
  readonly searchParams: AuctionPageProps['searchParams'];
}) {
  // history 조회가 URL의 item param을 필요로 하므로 search를 먼저 기다린 뒤 loader에 넘긴다.
  const search = await loadDecisionSearch(searchParams);
  const data = await loadAuctionPage(params, search, {
    parseAuctionId,
    getAuction: getAuctionFromServer,
    now: () => systemClock.now().toString(),
    listAttempts: listOrganizationAuctionAttemptsFromServer,
    listAttemptsLatest: listOrganizationAuctionAttemptsFromServerLatest,
    findDistribution: findWinRateDistributionFromServer
  });

  if (!data) notFound();
  // 내 투찰은 로그인 사용자의 개인 자료라 RSC 캐시 밖의 브라우저 provider가 조립한다. 차트가 그리는 첫 페이지
  // 표본과 같은 build를 넘겨 표와 점이 같은 계보를 말하게 한다. DecisionScreen 자체는 모른다.
  const sample = data.history.state === 'ready' ? data.history.presentation : null;
  return (
    <OwnBidProvider
      organizationId={sample?.organizationId ?? null}
      buildId={sample?.buildId ?? null}
      rows={sample?.rows ?? []}
    >
      <DecisionScreen
        decision={data.decision}
        search={search}
        history={data.history}
        distribution={data.distribution}
      />
    </OwnBidProvider>
  );
}

// params·searchParams를 page 최상위에서 await하면 static shell이 사라진다(ADR 0028). promise를 Suspense
// 안 loader에 넘겨 shell은 prerender하고 공고 본문만 request 시점에 streaming한다. fallback은 loading.tsx와
// 같은 skeleton이다.
export default function AuctionPage({ params, searchParams }: AuctionPageProps) {
  return (
    <Suspense fallback={<DecisionScreenSkeleton />}>
      <AuctionLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
