/** @module 책임: 공고 RSC route에서 params 접근을 Suspense 안 loader로 격리하고 계약 조회 결과를 화면과 Next notFound 경계로 분기한다. */
import {
  getAuctionFromServer,
  isAuctionNotFoundError,
  parseAuctionId
} from '@/api/auctions/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { loadAuctionPage } from './_model/load-auction-page';
import { AuctionScreen } from './_ui/auction-screen';
import { AuctionScreenSkeleton } from './_ui/auction-screen-skeleton';

type AuctionPageParams = PageProps<'/auctions/[auctionId]'>['params'];

async function AuctionLoader({ params }: { readonly params: AuctionPageParams }) {
  const auction = await loadAuctionPage(params, {
    parseAuctionId,
    getAuction: getAuctionFromServer,
    isNotFound: isAuctionNotFoundError
  });

  if (!auction) notFound();
  return <AuctionScreen auction={auction} />;
}

// params를 page 최상위에서 await하면 static shell이 사라진다(ADR 0028). promise를 Suspense 안 loader에 넘겨
// shell은 prerender하고 공고 본문만 request 시점에 streaming한다. fallback은 loading.tsx와 같은 skeleton이다.
export default function AuctionPage({ params }: PageProps<'/auctions/[auctionId]'>) {
  return (
    <Suspense fallback={<AuctionScreenSkeleton />}>
      <AuctionLoader params={params} />
    </Suspense>
  );
}
