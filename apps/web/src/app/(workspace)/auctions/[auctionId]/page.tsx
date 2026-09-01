/** @module 책임: 공고 RSC route에서 계약 조회 결과를 화면과 Next notFound 경계로 분기한다. */
import {
  getAuctionFromServer,
  isAuctionNotFoundError,
  parseAuctionId
} from '@/api/auctions/server';
import { notFound } from 'next/navigation';

import { loadAuctionPage } from './_model/load-auction-page';
import { AuctionScreen } from './_ui/auction-screen';

export default async function AuctionPage({ params }: PageProps<'/auctions/[auctionId]'>) {
  const auction = await loadAuctionPage(params, {
    parseAuctionId,
    getAuction: getAuctionFromServer,
    isNotFound: isAuctionNotFoundError
  });

  if (!auction) notFound();
  return <AuctionScreen auction={auction} />;
}
