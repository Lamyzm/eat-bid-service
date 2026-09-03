/** @module 책임: 공고 RSC route에서 params·searchParams 접근을 Suspense 안 loader로 격리하고 계약 조회 결과를 화면과 Next notFound 경계로 분기한다. */
import { systemClock } from '@eatbid/domain';
import {
  getAuctionFromServer,
  isAuctionNotFoundError,
  parseAuctionId
} from '@/api/auctions/server';
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
  const [decision, search] = await Promise.all([
    loadAuctionPage(params, {
      parseAuctionId,
      getAuction: getAuctionFromServer,
      isNotFound: isAuctionNotFoundError,
      // rail 상태는 이 문자열을 schedule의 wire instant와 사전순으로만 비교한다(rail-state.ts). 초 미만
      // 정밀도가 섞이면 "02:00:00Z"보다 "02:00:00.123Z"이 사전순으로 앞서는 착시가 생기므로 초 단위로 자른다.
      now: () => systemClock.now().toString({ smallestUnit: 'second' })
    }),
    loadDecisionSearch(searchParams)
  ]);

  if (!decision) notFound();
  return <DecisionScreen decision={decision} search={search} />;
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
