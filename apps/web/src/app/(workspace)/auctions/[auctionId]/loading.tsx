/** @module 책임: 공고 segment의 최초 server loading을 화면 전용 skeleton 경계에 연결한다. */
import { AuctionScreenSkeleton } from './_ui/auction-screen-skeleton';

export default function Loading() {
  return <AuctionScreenSkeleton />;
}
