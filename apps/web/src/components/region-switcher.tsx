'use client';
/**
 * 헤더 지역 칩 (B안) — 보이는 것이 곧 상태
 * 자격 지역을 전부 칩으로 나열 + 진행 중 공고 수 배지 · 클릭 1회 전환
 * 구경 중이면 임시 칩(노란색)이 붙고, 자격 지역이 없으면 "전체 지역" 하나만.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRegion } from '@/lib/region';

export function RegionSwitcher() {
  const { homes, view, isBrowsing, setView, ready } = useRegion();
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then((xs: any[]) => {
      if (!Array.isArray(xs)) return;
      const m: Record<string, number> = {};
      for (const o of xs) if (o.sigungu) m[o.sigungu] = (m[o.sigungu] ?? 0) + 1;
      setOpenCounts(m);
    }).catch(() => {});
  }, []);

  const total = useMemo(() => Object.values(openCounts).reduce((a, b) => a + b, 0), [openCounts]);
  if (!ready) return null;

  const chip = (active: boolean, warn = false) =>
    `h-7 shrink-0 rounded-full border px-2.5 text-xs transition-colors ${
      active
        ? warn ? 'border-amber-500 bg-amber-500/15 text-amber-700 font-semibold'
               : 'bg-primary text-primary-foreground border-primary font-semibold'
        : warn ? 'border-amber-500/60 text-amber-600' : 'bg-background hover:bg-accent'
    }`;

  return (
    <div className='flex max-w-[46vw] items-center gap-1 overflow-x-auto' aria-label='보는 지역'>
      <button type='button' className={chip(view === 'home')} onClick={() => setView('home')}
        title={homes.length ? '내 자격 지역 전체' : '전체 지역'}>
        {homes.length > 1 ? '내 지역 전체' : homes.length === 1 ? '내 지역' : '전체 지역'}
        {homes.length !== 1 && total > 0 && <span className='ml-1 opacity-70'>{total}</span>}
      </button>
      {homes.map(h => (
        <button key={h} type='button' className={chip(view === h)} onClick={() => setView(h)}>
          {h}
          {openCounts[h] ? <span className='ml-1 opacity-70'>{openCounts[h]}</span> : null}
        </button>
      ))}
      {isBrowsing && !homes.includes(view) && (
        <button type='button' className={chip(true, true)} onClick={() => setView('home')}
          title='구경 중 — 누르면 내 지역으로 돌아갑니다'>
          {view}
          {openCounts[view] ? <span className='ml-1 opacity-70'>{openCounts[view]}</span> : null}
          <span className='ml-1'>✕</span>
        </button>
      )}
    </div>
  );
}
