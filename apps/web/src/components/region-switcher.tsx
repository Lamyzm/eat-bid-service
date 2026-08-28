'use client';
/**
 * 헤더 전역 지역 스위처 — 보는 지역(viewRegion)의 유일한 조작점
 * '내 자격 지역'(집합) 기본, 개별 지역 선택 = 구경(노란색 표시). 목록은 데이터 유도.
 */
import { useEffect, useState } from 'react';
import { useRegion } from '@/lib/region';

export function RegionSwitcher() {
  const { homes, view, isBrowsing, setView, ready } = useRegion();
  const warn = isBrowsing && homes.length > 0; // 자격 지역이 있을 때만 경고색 (U18)
  const [regions, setRegions] = useState<{ sigungu: string; n: number }[]>([]);

  useEffect(() => {
    fetch('/api/wins/regions').then(r => r.json())
      .then(x => setRegions(Array.isArray(x) ? x : [])).catch(() => {});
  }, []);

  if (!ready) return null;
  const label = view === 'home'
    ? (homes.length ? `내 지역 ${homes.length > 1 ? `(${homes.length})` : homes[0]}` : '전체 지역')
    : `${view} · 구경 중`;

  return (
    <select
      value={view}
      onChange={e => setView(e.target.value)}
      title={warn ? '내 자격 지역이 아닌 지역을 보는 중입니다' : '보는 지역'}
      className={`h-8 max-w-[150px] rounded-md border px-2 text-sm ${
        warn ? 'border-amber-500 text-amber-600' : 'bg-background'
      }`}
      aria-label='보는 지역'
    >
      <option value='home'>{homes.length ? `내 자격 지역${homes.length > 1 ? ` (${homes.length})` : ` · ${homes[0]}`}` : '전체 지역'}</option>
      {regions.map(r => (
        <option key={r.sigungu} value={r.sigungu}>{r.sigungu}</option>
      ))}
    </select>
  );
}
