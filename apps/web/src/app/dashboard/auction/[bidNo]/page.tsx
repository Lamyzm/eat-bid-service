/** @module 책임: legacy 공고 상세 route에서 공고 번호·투찰률 검색 조건을 해석해 상세 화면에 전달한다. */
import { AuctionDetail } from './auction-detail';

export default async function AuctionPage({ params, searchParams }: {
  params: Promise<{ bidNo: string }>;
  searchParams: Promise<{ rate?: string }>;
}) {
  const { bidNo } = await params;
  const sp = await searchParams;
  const API = process.env.API_URL ?? 'http://localhost:8081';

  const open = await fetch(`${API}/api/open/${bidNo}`, { cache: 'no-store' }).then(r => r.json());
  if (!open) {
    return <div className='p-8'>이 공고를 찾을 수 없습니다. 이미 마감됐거나 목록이 갱신됐을 수 있습니다.</div>;
  }
  const [auctions, roster] = await Promise.all([
    open.schoolId
      ? fetch(`${API}/api/schools/${encodeURIComponent(open.schoolId)}/auctions`, { cache: 'no-store' }).then(r => r.json())
      : [],
    open.schoolId
      ? fetch(`${API}/api/schools/${encodeURIComponent(open.schoolId)}/roster`, { cache: 'no-store' }).then(r => r.json())
      : { rows: [], maxStreak: 0 },
  ]);

  return <AuctionDetail open={open} auctions={auctions} roster={roster} initialRate={sp.rate ?? null} />;
}
