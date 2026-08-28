'use client';
/**
 * 데이터 화면 제목 아래 상태 한 줄 (배치 #5)
 * "김해시 기준 · 공고 12건 · 자격 2곳 중 1곳 보는 중" + 다른 지역 둘러보기 선택
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRegion } from '@/lib/region';

export function RegionStatus({ extra }: { extra?: React.ReactNode }) {
  const { homes, view, isBrowsing, setView, ready } = useRegion();
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [regions, setRegions] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then((xs: any[]) => {
      if (!Array.isArray(xs)) return;
      const scope = view === 'home' ? homes : [view];
      setOpenCount(scope.length ? xs.filter(o => o.sigungu && scope.includes(o.sigungu)).length : xs.length);
    }).catch(() => {});
  }, [view, homes.join(',')]);

  useEffect(() => {
    fetch('/api/wins/regions').then(r => r.json())
      .then(x => setRegions(Array.isArray(x) ? x.map((r: any) => r.sigungu) : [])).catch(() => {});
  }, []);

  const scopeLabel = useMemo(() => {
    if (view !== 'home') return `${view} 기준`;
    if (homes.length === 0) return '전체 지역 기준';
    if (homes.length === 1) return `${homes[0]} 기준`;
    return `내 지역 ${homes.length}곳 기준`;
  }, [view, homes]);

  if (!ready) return null;

  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums'>
      <span className='text-foreground font-medium'>{scopeLabel}</span>
      {openCount != null && <span>· 진행 중 공고 {openCount}건</span>}
      {homes.length > 0 && (
        <span>· 자격 {homes.length}곳{isBrowsing ? ` 중 다른 지역(${view}) 보는 중` : view === 'home' && homes.length > 1 ? ' 전체 보는 중' : ''}</span>
      )}
      {homes.length === 0 && (
        <span>· <Link href='/dashboard/my' className='text-primary hover:underline'>내 자격 지역 설정</Link></span>
      )}
      {extra}
      <select
        value={isBrowsing ? view : ''}
        onChange={e => setView(e.target.value || 'home')}
        className='bg-background ml-auto h-7 rounded border px-1.5 text-xs'
        aria-label='다른 지역 둘러보기'
      >
        <option value=''>다른 지역 둘러보기…</option>
        {regions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}
