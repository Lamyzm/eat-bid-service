'use client';
import dynamic from 'next/dynamic';

// leaflet은 window 필요 → 클라이언트 전용 로드
const MarketMap = dynamic(() => import('./market-map').then(m => m.MarketMap), {
  ssr: false,
  loading: () => <div className='text-muted-foreground p-8'>지도를 불러오는 중…</div>,
});

export default function MarketPage() {
  return <MarketMap />;
}
