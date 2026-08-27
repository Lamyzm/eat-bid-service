'use client';
/**
 * 분석판 — 학교 단위 분석 워크벤치 (스펙 v3)
 * 렌즈 6: 흐름 / 분포 / 리허설 / 리플레이 / 추첨 / 월별
 * 공통 문법: 모든 차트 요소·표 행 클릭 = 우측 산출기에 값 주입 (비드큐 문법)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  createChart, LineSeries, HistogramSeries, createSeriesMarkers,
  LineStyle, CrosshairMode, type IChartApi, type UTCTimestamp,
} from 'lightweight-charts';
import { useWorkspace } from '@/lib/workspace';
import { useMarks } from '@/lib/marks';
import { useTrack, trackAction, trackOnce } from '@/lib/track';
import { won } from '@/lib/format';
import { CHART as C, myMarker, chartFrame } from '@/lib/chart-colors';
import { RosterTable, type RosterRow } from '@/components/roster-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Round = {
  bidId: string; openedAt: string; category: string | null; floorRate: number | null;
  winRate: number | null; basePrice: number | null; nValid: number; winnerBiz: string | null;
  nBids: number | null; maxInvalid: number | null; secondRate: number | null; winnerName?: string | null;
  plannedPrice: number | null; effFloor: number | null;
  reserves: { r: number; c: boolean }[] | null;
};
type Replay = {
  meta: { openedAt: string | null; basePrice: number | null; floorRate: number | null;
    winRate: number | null; n: number; nValid: number; gap12: number | null; maxInvalid: number | null } | null;
  bids: { bizNo: string; name: string; bidRate: number; won: boolean; status: string }[];
};

const LENSES = [
  ['flow', '흐름'], ['record', '기록'], ['dist', '분포'], ['rehearsal', '리허설'],
  ['replay', '리플레이'], ['lottery', '추첨'], ['monthly', '월별'],
] as const;
type Lens = typeof LENSES[number][0];
const PERIODS = [['3m', '3개월', 3], ['6m', '6개월', 6], ['12m', '12개월', 12], ['all', '전체', 999]] as const;

/** 판정: 실효하한 보유 회차는 확정, 미보유는 경계 기반 */
function verdictOf(r: number, x: Round): '밀림' | '낙찰' | '기회' | '무효' {
  if (x.winRate == null) return '기회';
  if (r >= x.winRate) return '밀림';
  if (x.effFloor != null) return r < x.effFloor ? '무효' : '낙찰';
  if (x.maxInvalid != null && r <= x.maxInvalid) return '무효';
  return '기회';
}
const VCOLOR: Record<string, string> = { 밀림: C.second, 낙찰: C.win, 기회: C.me, 무효: C.invalid };

/** 호버-리플레이 세션 캐시 — 같은 회차 재호버 시 무요청 (D 티켓) */
const replayCache = new Map<string, Replay>();

/** 범용 히스토그램 — 막대 클릭 배선 */
function Hist({ values, binSize, fmt, highlight, onBar, marks }: {
  values: number[]; binSize: number; fmt: (v: number) => string;
  highlight?: [number, number] | null; onBar?: (lo: number, hi: number) => void;
  marks?: { v: number; label: string; color: string }[];
}) {
  if (values.length === 0) return <p className='text-muted-foreground py-6 text-sm'>표본이 없습니다.</p>;
  const lo = Math.floor(Math.min(...values) / binSize) * binSize;
  const hi = Math.ceil((Math.max(...values) + 1e-9) / binSize) * binSize;
  const nBins = Math.max(1, Math.round((hi - lo) / binSize));
  const bins = Array.from({ length: nBins }, (_, i) => ({
    lo: +(lo + i * binSize).toFixed(6), hi: +(lo + (i + 1) * binSize).toFixed(6), n: 0,
  }));
  for (const v of values) {
    const i = Math.min(nBins - 1, Math.floor((v - lo) / binSize));
    bins[i].n++;
  }
  const W = 900, H = 230, L = 34, B = 40, T = 14;
  const maxN = Math.max(...bins.map(b => b.n));
  const bw = (W - L - 10) / nBins;
  const X = (i: number) => L + i * bw;
  const Y = (n: number) => T + (H - T - B) * (1 - n / maxN);
  let lastLbl = -Infinity;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: 'auto', minWidth: 620 }}>
        {bins.map((b, i) => {
          const hot = highlight && b.hi > highlight[0] && b.lo < highlight[1];
          return (
            <g key={i} style={{ cursor: onBar && b.n ? 'pointer' : undefined }}
              onClick={() => b.n && onBar?.(b.lo, b.hi)}>
              <rect x={X(i) + 1.5} y={Y(b.n)} width={bw - 3} height={H - B - Y(b.n)}
                fill={hot ? C.floor : 'var(--primary)'} opacity={hot ? 0.85 : 0.65} rx={2}>
                <title>{fmt(b.lo)}~{fmt(b.hi)} · {b.n}회{onBar ? ' · 클릭=산출기 적용' : ''}</title>
              </rect>
              {b.n > 0 && <text x={X(i) + bw / 2} y={Y(b.n) - 4} textAnchor='middle' fontSize={11.5}
                fill='var(--foreground)' fontFamily='var(--font-mono, monospace)'>{b.n}</text>}
            </g>
          );
        })}
        {bins.map((b, i) => {
          const x = X(i); const show = x - lastLbl >= 46; if (show) lastLbl = x;
          return show ? (
            <text key={`l-${i}`} x={x} y={H - B + 16} fontSize={11.5} textAnchor='middle'
              fill='var(--muted-foreground)' fontFamily='var(--font-mono, monospace)'>{fmt(b.lo)}</text>
          ) : null;
        })}
        {marks?.map((m, i) => {
          const x = L + (m.v - lo) / (hi - lo) * (W - L - 10);
          if (x < L || x > W - 10) return null;
          return (
            <g key={`m-${i}`}>
              <line x1={x} y1={T} x2={x} y2={H - B} stroke={m.color} strokeWidth={1.8} strokeDasharray='5 3' />
              <text x={x} y={H - B + 32} textAnchor='middle' fontSize={11.5} fill={m.color}
                fontFamily='var(--font-mono, monospace)'>{m.label}</text>
            </g>
          );
        })}
        <text x={W - 10} y={12} textAnchor='end' fontSize={12} fill='var(--muted-foreground)'>{values.length}회</text>
      </svg>
    </div>
  );
}

export function AnalysisBoard({ school, rounds, initialRate, initialBase }: {
  school: any; rounds: Round[]; initialRate?: string | null; initialBase?: string | null;
}) {
  const { bizNos } = useWorkspace();
  const { marks, set: setMark } = useMarks();
  useTrack('analysis');
  // 렌즈 기억: 최초 방문=흐름, 이후 마지막 사용 렌즈
  const [lens, setLensState] = useState<Lens>('flow');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('eatbid.lens') as Lens | null;
      if (saved && LENSES.some(([k]) => k === saved)) setLensState(saved);
    } catch {}
  }, []);
  const setLens = (l: Lens) => {
    setLensState(l);
    try { localStorage.setItem('eatbid.lens', l); } catch {}
  };
  const [period, setPeriod] = useState<'3m' | '6m' | '12m' | 'all'>('all');

  const floors = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rounds) if (r.floorRate != null && r.winRate != null)
      m.set(r.floorRate, (m.get(r.floorRate) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [rounds]);
  const [floor, setFloor] = useState<number | null>(null);
  useEffect(() => { if (floor == null && floors.length) setFloor(floors[0]); }, [floors, floor]);

  // 기간 필터 → view (하한 필터 포함)
  const cutoff = useMemo(() => {
    const months = PERIODS.find(p => p[0] === period)![2];
    if (months > 100) return '0000';
    const d = new Date(); d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }, [period]);
  const all = useMemo(() => rounds.filter(x => x.winRate != null && x.openedAt >= cutoff), [rounds, cutoff]);
  const view = useMemo(() => {
    const rs = all.filter(x => x.floorRate === floor)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    let prev = ''; let dup = 0;
    return rs.map(x => {
      dup = x.openedAt === prev ? dup + 1 : 0; prev = x.openedAt;
      return { ...x, t: (Date.parse(x.openedAt + 'T00:00:00Z') / 1000 + dup * 3600) as UTCTimestamp };
    });
  }, [all, floor]);

  const dense = useMemo(() => {
    const bf = (school?.byFloor ?? {}) as Record<string, any>;
    const st = floor != null ? (bf[String(floor)] ?? bf[floor.toFixed(1)]) : null;
    return st?.dense ?? null;
  }, [school, floor]);

  // ── 산출기 (전 렌즈 공유) ──
  const latest = view.at(-1) ?? all.at(-1);
  const [baseStr, setBaseStr] = useState(initialBase ?? '');
  useEffect(() => { if (!baseStr && latest?.basePrice) setBaseStr(String(latest.basePrice)); }, [latest]);
  const base = Number(baseStr.replace(/[^0-9]/g, '')) || 0;
  const [rateStr, setRateStr] = useState(initialRate ?? '');
  const rate = parseFloat(rateStr);
  const r = Number.isFinite(rate) ? rate : null;
  const inject = (v: number) => setRateStr(v.toFixed(3));
  const amount = r != null && base ? Math.round(base * r / 100) : null;

  // 몰림 — 최근 14일 전장 투찰값 분포 (산출기 한 줄)
  const [crowd, setCrowd] = useState<{ days: number; total: number; bins: { v: number; n: number }[] } | null>(null);
  useEffect(() => {
    if (floor == null) return;
    fetch(`/api/wins/crowd?days=14&floor=${floor}`).then(res => res.json()).then(setCrowd).catch(() => {});
  }, [floor]);
  const crowdN = useMemo(() => {
    if (crowd == null || r == null) return null;
    const k = Math.round(r * 100) / 100;
    return crowd.bins.find(b => Math.abs(b.v - k) < 1e-9)?.n ?? 0;
  }, [crowd, r]);

  // 예정가율 분포 (이 학교) → 하한 흔들림 범위
  const pprs = useMemo(() => all
    .filter(x => x.plannedPrice != null && x.basePrice)
    .map(x => x.plannedPrice! / x.basePrice! * 100).sort((a, b) => a - b), [all]);
  const pprLo = pprs.length ? pprs[Math.floor(pprs.length * 0.05)] : null;
  const pprHi = pprs.length ? pprs[Math.floor(pprs.length * 0.95)] : null;

  // 리허설 판정 집계
  const verdicts = useMemo(() => {
    if (r == null) return null;
    const c = { 밀림: 0, 낙찰: 0, 기회: 0, 무효: 0 };
    for (const x of view) c[verdictOf(r, x)]++;
    return c;
  }, [r, view]);

  // 내 투찰
  const [my, setMy] = useState<{ openedAt: string | null; floorRate: number | null; bidRate: number | null; won: number }[]>([]);
  useEffect(() => {
    if (!school || bizNos.length === 0) return;
    fetch(`/api/schools/${encodeURIComponent(school.id)}/my-bids?bizNos=${bizNos.join(',')}`)
      .then(res => res.json()).then(setMy).catch(() => {});
  }, [school, bizNos]);

  // 진행 중 공고 + 로스터
  const [openBids, setOpenBids] = useState<any[]>([]);
  const [roster, setRoster] = useState<{ rows: RosterRow[]; maxStreak: number }>({ rows: [], maxStreak: 0 });
  useEffect(() => {
    if (!school) return;
    fetch('/api/open').then(res => res.json())
      .then((xs: any[]) => setOpenBids(xs.filter(x => x.schoolId === school.id))).catch(() => {});
    fetch(`/api/schools/${encodeURIComponent(school.id)}/roster`).then(res => res.json()).then(setRoster).catch(() => {});
  }, [school]);

  // 리플레이
  const [replayId, setReplayId] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  // 호버 미니 사다리 (흐름 렌즈)
  const [hoverLadder, setHoverLadder] = useState<{ bidId: string; bids: Replay['bids'] } | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!replayId) return;
    fetch(`/api/rounds/${encodeURIComponent(replayId)}`).then(res => res.json()).then(setReplay).catch(() => {});
  }, [replayId]);
  const openReplay = (bidId: string) => { setReplayId(bidId); setLens('replay'); };

  // 분포 드릴다운
  const [drill, setDrill] = useState<[number, number] | null>(null);
  useEffect(() => { setDrill(null); }, [floor, period]);
  const margins = useMemo(() => view.filter(x => x.floorRate != null)
    .map(x => +(x.winRate! - x.floorRate!).toFixed(3)), [view]);

  // ── 흐름 차트 ──
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<(Round & { t: UTCTimestamp }) | null>(null);
  useEffect(() => {
    if (lens !== 'flow' || !elRef.current || floor == null) return;
    const frame = chartFrame();
    const chart = createChart(elRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: frame.text,
        fontSize: 12, fontFamily: "'Geist Mono','Pretendard Variable',monospace" },
      grid: { vertLines: { color: 'rgba(127,127,127,0.08)' }, horzLines: { color: 'rgba(127,127,127,0.12)' } },
      rightPriceScale: { borderColor: frame.border, scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: frame.border },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => p.toFixed(2) },
    });
    chartRef.current = chart;
    const win = chart.addSeries(LineSeries, {
      color: C.win, lineWidth: 2, priceLineVisible: false, title: '낙찰률',
      pointMarkersVisible: true, pointMarkersRadius: 3,
    });
    win.setData(view.map(x => ({ time: x.t, value: x.winRate! })));
    win.createPriceLine({ price: floor, color: C.floor, lineWidth: 2, title: `하한 ${floor}` });
    if (dense) {
      win.createPriceLine({ price: dense.lo, color: C.band, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `구간 ${dense.lo.toFixed(2)}` });
      win.createPriceLine({ price: dense.hi, color: C.band, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `구간 ${dense.hi.toFixed(2)}` });
    }
    if (r != null) win.createPriceLine({ price: r, color: C.me, lineWidth: 2, lineStyle: LineStyle.LargeDashed, title: `내 값 ${r.toFixed(3)}` });
    const s2 = chart.addSeries(LineSeries, {
      color: C.second, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false,
      lastValueVisible: false, title: '2등가', pointMarkersVisible: true, pointMarkersRadius: 2,
    });
    s2.setData(view.filter(x => x.secondRate != null).map(x => ({ time: x.t, value: x.secondRate! })));
    const ef = chart.addSeries(LineSeries, {
      color: C.invalid, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false,
      lastValueVisible: false, title: '실효하한', pointMarkersVisible: true, pointMarkersRadius: 2,
    });
    ef.setData(view.filter(x => x.effFloor != null).map(x => ({ time: x.t, value: x.effFloor! })));
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol', color: 'rgba(120,130,125,0.4)', priceFormat: { type: 'volume' },
      priceLineVisible: false, lastValueVisible: false, title: '참여',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(view.map(x => ({ time: x.t, value: x.nBids ?? x.nValid })));
    const myPts = my.filter(m => m.floorRate === floor && m.bidRate != null && m.openedAt);
    if (myPts.length) {
      const byDate = new Map(view.map(x => [x.openedAt, x.t]));
      createSeriesMarkers(win, myPts.filter(m => byDate.has(m.openedAt!)).map(m => ({
        time: byDate.get(m.openedAt!)!, position: 'aboveBar' as const,
        color: m.won ? C.win : myMarker(), shape: 'arrowDown' as const, text: `내 ${m.bidRate!.toFixed(2)}`,
      })));
    }
    chart.timeScale().fitContent();
    // 호버 프리페치 — onMove와 qa 훅이 동일 경로를 타도록 단일 함수 (qa 판정 반영)
    const prefetchRound = (x: (typeof view)[number] | null) => {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      if (!x) { hoverIdRef.current = null; setHoverLadder(null); return; }
      if (hoverIdRef.current === x.bidId) return; // 같은 회차 재호버 — 유지
      hoverIdRef.current = x.bidId;
      const cached = replayCache.get(x.bidId);
      if (cached) { setHoverLadder({ bidId: x.bidId, bids: cached.bids }); return; }
      setHoverLadder(null);
      hoverTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/rounds/${encodeURIComponent(x.bidId)}`);
          const d: Replay = await res.json();
          replayCache.set(x.bidId, d);
          if (hoverIdRef.current === x.bidId) setHoverLadder({ bidId: x.bidId, bids: d.bids });
        } catch {}
      }, 300);
    };
    const onMove = (p: any) => {
      const x = p?.time ? view.find(v => v.t === p.time) ?? null : null;
      setHover(x);
      prefetchRound(x);
    };
    const onClick = (p: any) => {
      if (!p?.time) return;
      const x = view.find(v => v.t === p.time);
      if (x?.winRate != null) { inject(x.winRate); openReplay(x.bidId); }
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    // 자동 검증용 (qa) — v5 setCrosshairPosition은 crosshairMove를 발화하지 않으므로
    // onMove와 동일한 prefetchRound 경로를 직접 호출한다. 프로덕션 무해.
    (window as any).__eatbidChart = {
      hover: (i: number) => {
        const x = view[i];
        if (x?.winRate == null) return;
        chart.setCrosshairPosition(x.winRate, x.t, win);
        setHover(x);
        prefetchRound(x);
      },
      clear: () => { (chart as any).clearCrosshairPosition?.(); setHover(null); prefetchRound(null); },
      n: view.length,
    };
    return () => {
      delete (window as any).__eatbidChart;
      chart.remove(); chartRef.current = null;
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    };
  }, [lens, view, dense, floor, r, my]);

  // 월별 매트릭스 (하한 무관, 학교 전체)
  const monthly = useMemo(() => {
    const cell = new Map<string, { n: number; wins: number[] }>();
    const cats = new Set<string>();
    for (const x of rounds.filter(x => x.winRate != null)) {
      const m = x.openedAt.slice(0, 7); const c = x.category ?? '기타';
      cats.add(c);
      const k = `${m}|${c}`;
      const v = cell.get(k) ?? { n: 0, wins: [] };
      v.n++; v.wins.push(x.winRate!); cell.set(k, v);
    }
    const months = [...new Set(rounds.map(x => x.openedAt.slice(0, 7)))].sort().reverse().slice(0, 24);
    return { months, cats: [...cats], cell };
  }, [rounds]);

  // 추첨 렌즈 데이터
  const reserveRatios = useMemo(() => all.flatMap(x => (x.reserves ?? []).map(v => v.r * 100)), [all]);

  // 발주 예보 — 최근 간격 중앙값
  const forecast = useMemo(() => {
    const dates = [...new Set(rounds.map(x => x.openedAt))].sort();
    if (dates.length < 4) return null;
    const gaps = dates.slice(-7).slice(1).map((d, i) =>
      Math.round((+new Date(d) - +new Date(dates.slice(-7)[i])) / 864e5)).filter(g => g > 5 && g < 90).sort((a, b) => a - b);
    if (!gaps.length) return null;
    const med = gaps[Math.floor(gaps.length / 2)];
    const last = dates[dates.length - 1];
    const expected = new Date(+new Date(last) + med * 864e5);
    return { med, last, expected: expected.toISOString().slice(0, 10),
      due: Math.round((+expected - Date.now()) / 864e5) };
  }, [rounds]);

  if (!school) return <div className='p-8'>학교를 찾지 못했습니다.</div>;
  const openBid = openBids[0] ?? null;
  const mark = openBid ? marks[openBid.bidNo] : null;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      {/* 헤더 + 사실 칩 */}
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <div className='text-muted-foreground text-xs'>{school.sido} {school.sigungu} · 분석판</div>
          <h1 className='text-xl font-semibold'>{school.name}</h1>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            <Badge variant='secondary'>공고 {rounds.length}건</Badge>
            <Badge variant='secondary'>예정가 보유 {rounds.filter(x => x.plannedPrice != null).length}회</Badge>
            {openBid && <Badge>진행 중 공고 {openBids.length}건</Badge>}
            {my.length > 0 && <Badge variant='outline'>내 참여 {my.length}회</Badge>}
            {!openBid && forecast && (
              <Badge variant='outline' className='tabular-nums'>
                발주 주기 {forecast.med}일 · 다음 예상 {forecast.due <= 0 ? '도래' : `${forecast.expected} (D-${forecast.due})`}
              </Badge>
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {floors.map(f => (
            <Button key={f} size='sm' variant={floor === f ? 'default' : 'outline'}
              onClick={() => { setFloor(f); setReplayId(null); }}>하한 {f}</Button>
          ))}
          <span className='mx-1' />
          {PERIODS.map(([k, label]) => (
            <Button key={k} size='sm' variant={period === k ? 'default' : 'outline'}
              onClick={() => setPeriod(k as any)}>{label}</Button>
          ))}
          <Button size='sm' variant='outline' onClick={() => window.print()}>인쇄</Button>
        </div>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_320px]'>
        {/* ── 메인: 렌즈 ── */}
        <Card>
          <CardContent className='p-3'>
            <div className='mb-3 flex gap-1 overflow-x-auto pb-1' style={{ scrollbarWidth: 'thin' }}>
              {LENSES.map(([k, label]) => (
                <Button key={k} size='sm' className='shrink-0' variant={lens === k ? 'default' : 'ghost'}
                  onClick={() => setLens(k)}>{label}</Button>
              ))}
            </div>

            {lens === 'flow' && (<>
              <div className='text-muted-foreground mb-1 flex flex-wrap gap-x-3 text-xs'>
                <span style={{ color: C.win }}>― 낙찰률</span>
                <span style={{ color: C.second }}>· 2등가</span>
                <span style={{ color: C.invalid }}>· 실효하한(예정가×하한)</span>
                <span>▮ 참여 수</span>
                <span>점 클릭 = 산출기 적용 + 리플레이</span>
              </div>
              <div ref={elRef} style={{ height: 430 }} />
              <div className='text-muted-foreground mt-2 flex min-h-[20px] flex-wrap gap-x-4 text-[13px] tabular-nums'>
                {hover ? (<>
                  <span className='text-foreground font-semibold'>{hover.openedAt}</span>
                  <span>{hover.category}</span>
                  <span>기초 {won(hover.basePrice)}원</span>
                  <span style={{ color: C.win }}>낙찰 {hover.winRate?.toFixed(3)}</span>
                  {hover.secondRate != null && <span style={{ color: C.second }}>2등 +{(hover.secondRate - hover.winRate!).toFixed(3)}</span>}
                  {hover.effFloor != null && <span style={{ color: C.invalid }}>실효하한 {hover.effFloor.toFixed(3)}</span>}
                  <span>참여 {hover.nBids ?? hover.nValid}곳</span>
                </>) : `${view.length}회 · 점 위 = 회차 정보, 클릭 = 리플레이`}
              </div>
              <div className='min-h-[20px]'>
                {hover && hoverLadder?.bidId === hover.bidId && hoverLadder.bids.length > 0 && (
                  <div className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums'>
                    {hoverLadder.bids.slice(0, 5).map((b, i) => (
                      <span key={b.bizNo} className='font-mono'
                        style={{ color: b.won ? C.win : b.status === '하한미달' ? C.invalid : undefined }}>
                        {i + 1}위 {b.bidRate.toFixed(3)} {b.won ? '낙찰' : b.status}
                      </span>
                    ))}
                    {hoverLadder.bids.length > 5 && <span className='text-muted-foreground'>… 외 {hoverLadder.bids.length - 5}곳 — 클릭=전체</span>}
                  </div>
                )}
              </div>
            </>)}

            {lens === 'dist' && floor != null && (<>
              <div className='mb-1 text-sm font-medium'>
                하한 {floor} 대비 낙찰 마진 분포
                {drill && <> — <span className='font-mono tabular-nums'>+{drill[0].toFixed(2)}~+{drill[1].toFixed(2)}</span> 확대
                  <Button size='sm' variant='ghost' className='ml-2 h-6 px-2' onClick={() => setDrill(null)}>← 전체</Button></>}
              </div>
              <Hist
                values={drill ? margins.filter(v => v >= drill[0] && v < drill[1]) : margins}
                binSize={drill ? 0.01 : 0.1}
                fmt={v => `+${v.toFixed(drill ? 2 : 1)}`}
                highlight={dense ? [dense.lo - floor, dense.hi - floor] : null}
                onBar={(lo, hi) => drill ? inject(floor + (lo + hi) / 2) : setDrill([lo, hi])}
                marks={r != null ? [{ v: r - floor, label: `내 값`, color: C.me }] : []}
              />
              <p className='text-muted-foreground mb-2 text-xs'>
                막대 클릭 = 0.01 단위 확대 · 확대 후 클릭 = 산출기 적용 · 빨간 막대 = 잘 나온 구간
              </p>
              {/* 구간×기간 매트릭스 */}
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>마진 구간</TableHead>
                    {[3, 6, 12, 24].map(m => <TableHead key={m} className='text-right'>최근 {m}개월</TableHead>)}
                    <TableHead className='text-right'>전체</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[0, 0.1, 0.2, 0.3].map(lo => {
                      const hi = lo === 0.3 ? 99 : lo + 0.1;
                      const label = lo === 0.3 ? '+0.3 이상' : `+${lo.toFixed(1)}~+${hi.toFixed(1)}`;
                      const rsAll = rounds.filter(x => x.floorRate === floor && x.winRate != null);
                      const inBin = (x: Round) => { const m = x.winRate! - x.floorRate!; return m >= lo && m < hi; };
                      const cols = [3, 6, 12, 24].map(mo => {
                        const cut = new Date(); cut.setMonth(cut.getMonth() - mo);
                        const c = cut.toISOString().slice(0, 10);
                        const sub = rsAll.filter(x => x.openedAt >= c);
                        const n = sub.filter(inBin).length;
                        return { n, pct: sub.length ? Math.round(n / sub.length * 100) : 0 };
                      });
                      const nAll = rsAll.filter(inBin).length;
                      const hot = dense && lo <= dense.hi - floor && hi >= dense.lo - floor;
                      return (
                        <TableRow key={lo} className={hot ? 'bg-destructive/5' : ''}>
                          <TableCell className='font-mono tabular-nums'>{label}{hot ? ' ●' : ''}</TableCell>
                          {cols.map((c, i) => (
                            <TableCell key={i} className='text-right tabular-nums'>{c.n}회 <span className='text-muted-foreground'>({c.pct}%)</span></TableCell>
                          ))}
                          <TableCell className='text-right font-semibold tabular-nums'>{nAll}회 <span className='text-muted-foreground font-normal'>({rsAll.length ? Math.round(nAll / rsAll.length * 100) : 0}%)</span></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>)}

            {lens === 'rehearsal' && (<>
              {r == null ? (
                <p className='text-muted-foreground py-6 text-sm'>
                  우측 산출기에 값을 넣으면 과거 {view.length}회를 그 값으로 다시 치릅니다.
                </p>
              ) : (<>
                <div className='mb-3 grid grid-cols-2 gap-2 text-center md:grid-cols-4'>
                  {(['밀림', '낙찰', '기회', '무효'] as const).map(k => (
                    <div key={k} className='rounded border px-2 py-2' style={k === '낙찰' ? { borderColor: C.win, borderWidth: 2 } : {}}>
                      <div className='text-xl font-bold tabular-nums' style={{ color: VCOLOR[k] }}>{verdicts?.[k] ?? 0}회</div>
                      <div className='text-muted-foreground text-xs'>
                        {k === '밀림' && '밀림 확정 (낙찰가 이상)'}
                        {k === '낙찰' && '낙찰 (실효하한~낙찰가 사이)'}
                        {k === '기회' && '기회 (예정가 미보유 회차)'}
                        {k === '무효' && '무효 확정 (실효하한 미만)'}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>날짜</TableHead><TableHead>품목</TableHead>
                      <TableHead className='text-right'>낙찰률</TableHead>
                      <TableHead className='text-right'>실효하한</TableHead>
                      <TableHead>판정</TableHead><TableHead>계산</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {[...view].reverse().map(x => {
                        const v = verdictOf(r, x);
                        return (
                          <TableRow key={x.bidId}>
                            <TableCell className='tabular-nums'>{x.openedAt}</TableCell>
                            <TableCell>{x.category}</TableCell>
                            <TableCell className='cursor-pointer text-right font-mono tabular-nums hover:underline'
                              onClick={() => inject(x.winRate!)}>{x.winRate!.toFixed(3)}</TableCell>
                            <TableCell className='text-right font-mono tabular-nums'>{x.effFloor?.toFixed(3) ?? '—'}</TableCell>
                            <TableCell><b style={{ color: VCOLOR[v] }}>{v}</b></TableCell>
                            <TableCell>
                              <details className='text-xs'>
                                <summary className='text-muted-foreground cursor-pointer'>보기</summary>
                                <div className='text-muted-foreground mt-1 font-mono'>
                                  {x.effFloor != null
                                    ? `실효하한 = ${x.floorRate} × 예정가 ${won(x.plannedPrice)} ÷ 기초 ${won(x.basePrice)} = ${x.effFloor.toFixed(3)}. `
                                    : '이 회차는 예정가 미보유 → 무효상한 기준. '}
                                  내 {r.toFixed(3)} {v === '밀림' ? `≥ 낙찰 ${x.winRate!.toFixed(3)} → 밀림`
                                    : v === '낙찰' ? `< 낙찰 ${x.winRate!.toFixed(3)}, ≥ 실효하한 → 낙찰`
                                    : v === '무효' ? `< 하한 경계 → 무효` : `< 낙찰 — 낙찰 또는 무효 (예정가 추첨이 가름)`}
                                </div>
                              </details>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className='text-muted-foreground mt-2 text-xs'>
                  과거 재생이며 다음 회차의 결과 예측이 아닙니다 — 예정가는 매회 추첨으로 새로 정해집니다.
                </p>
              </>)}
            </>)}

            {lens === 'replay' && (<>
              <div className='mb-2 flex flex-wrap items-center gap-2'>
                <span className='text-sm font-medium'>회차 선택</span>
                <select className='bg-card rounded border px-2 py-1 text-sm'
                  value={replayId ?? ''} onChange={e => setReplayId(e.target.value || null)}>
                  <option value=''>— 회차 —</option>
                  {[...view].reverse().map(x => (
                    <option key={x.bidId} value={x.bidId}>{x.openedAt} · {x.category} · 낙찰 {x.winRate?.toFixed(3)}</option>
                  ))}
                </select>
              </div>
              {!replay?.meta ? (
                <p className='text-muted-foreground py-6 text-sm'>회차를 고르거나 흐름 렌즈에서 점을 클릭하세요. 그날 전체 업체의 투찰이 낮은 값부터 표시됩니다.</p>
              ) : (<>
                <div className='mb-2 text-sm tabular-nums'>
                  <b>{replay.meta.openedAt}</b> · 기초 {won(replay.meta.basePrice)}원 · {replay.meta.n}곳 참여
                  {replay.meta.gap12 != null && <> · 1–2등 <b style={{ color: C.second }}>{replay.meta.gap12.toFixed(3)}</b> 차</>}
                </div>
                <div className='max-h-[460px] space-y-px overflow-y-auto text-[13px] tabular-nums'>
                  {(() => {
                    const groups: { rate: number; rows: typeof replay.bids }[] = [];
                    for (const b of replay.bids) {
                      const g = groups.at(-1);
                      if (g && Math.abs(g.rate - b.bidRate) < 1e-9) g.rows.push(b);
                      else groups.push({ rate: b.bidRate, rows: [b] });
                    }
                    return groups.map((g, gi) => (
                      <div key={gi} className='flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-accent'
                        onClick={() => inject(g.rate)}
                        style={{
                          background: g.rows.some(b => b.won) ? 'rgba(20,154,128,0.14)'
                            : g.rows[0].status === '하한미달' ? 'rgba(139,90,90,0.10)' : undefined,
                          color: g.rows[0].status === '하한미달' ? C.invalid : undefined,
                        }}>
                        <span className='truncate pr-2'>
                          {g.rows.map(b => b.name).join(' · ')}
                          {g.rows.length >= 2 && <Badge variant='secondary' className='ml-1.5'>동가 {g.rows.length}곳</Badge>}
                        </span>
                        <span className='flex shrink-0 items-center gap-2'>
                          <span className='font-mono'>{g.rate.toFixed(3)}</span>
                          <span className='text-xs'>{g.rows.some(b => b.won) ? '낙찰' : g.rows[0].status}</span>
                        </span>
                      </div>
                    ));
                  })()}
                </div>
                <p className='text-muted-foreground mt-2 text-xs'>행 클릭 = 그 값을 산출기에 적용</p>
              </>)}
            </>)}

            {lens === 'lottery' && (<>
              <div className='mb-1 text-sm font-medium'>복수예가 분포 <span className='text-muted-foreground font-normal'>— 회차마다 15개가 공개되고 4개가 추첨됩니다</span></div>
              <Hist values={reserveRatios} binSize={0.5} fmt={v => v.toFixed(1)}
                marks={pprLo != null && pprHi != null ? [
                  { v: pprLo, label: `예정가율 5% ${pprLo.toFixed(2)}`, color: C.me },
                  { v: pprHi, label: `95% ${pprHi.toFixed(2)}`, color: C.me },
                ] : []} />
              <div className='mb-1 mt-4 text-sm font-medium'>실제 예정가율(추첨 결과) 분포</div>
              <Hist values={pprs} binSize={0.2} fmt={v => v.toFixed(1)} />
              {base > 0 && floor != null && pprLo != null && pprHi != null && (
                <p className='mt-2 text-sm tabular-nums'>
                  기초금액 {won(base)}원 기준 — 이 학교 예정가율 90%가{' '}
                  <b className='font-mono'>{pprLo.toFixed(2)}~{pprHi.toFixed(2)}%</b> 사이였으므로,
                  하한 금액은 <b>{won(base * floor / 100 * pprLo / 100)}~{won(base * floor / 100 * pprHi / 100)}원</b> 범위에서 정해졌습니다.
                </p>
              )}
            </>)}

            {lens === 'record' && (
              <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>날짜</TableHead><TableHead>품목</TableHead>
                    <TableHead className='text-right'>기초금액</TableHead>
                    <TableHead className='text-right'>하한</TableHead>
                    <TableHead className='text-right'>낙찰률</TableHead>
                    <TableHead>낙찰 업체</TableHead>
                    <TableHead className='text-right'>참여</TableHead>
                    <TableHead className='text-right'>내 투찰</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...all].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).map(x => {
                      const mine = my.find(m => m.openedAt === x.openedAt && m.floorRate === x.floorRate);
                      return (
                        <TableRow key={x.bidId} className={mine ? 'bg-primary/5' : ''}>
                          <TableCell className='tabular-nums'>{x.openedAt}</TableCell>
                          <TableCell>{x.category}</TableCell>
                          <TableCell className='text-right tabular-nums'>{won(x.basePrice)}</TableCell>
                          <TableCell className='text-right tabular-nums'>{x.floorRate}</TableCell>
                          <TableCell className='cursor-pointer text-right font-mono font-semibold tabular-nums hover:underline'
                            onClick={() => { inject(x.winRate!); }}>{x.winRate?.toFixed(3)}</TableCell>
                          <TableCell className='max-w-[160px] truncate'>{x.winnerName ?? '-'}</TableCell>
                          <TableCell className='cursor-pointer text-right tabular-nums hover:underline'
                            onClick={() => openReplay(x.bidId)}>{x.nBids ?? x.nValid}곳</TableCell>
                          <TableCell className='text-right font-mono tabular-nums'>
                            {mine?.bidRate != null ? mine.bidRate.toFixed(3) : ''}
                            {mine?.won ? ' 낙찰' : ''}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className='text-muted-foreground p-3 text-xs'>낙찰률 클릭 = 산출기 적용 · 참여 클릭 = 리플레이</p>
              </div>
            )}

            {lens === 'monthly' && (
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>월</TableHead>
                    {monthly.cats.map(c => <TableHead key={c} className='text-right'>{c}</TableHead>)}
                  </TableRow></TableHeader>
                  <TableBody>
                    {monthly.months.map(m => (
                      <TableRow key={m}>
                        <TableCell className='font-medium tabular-nums'>{m}</TableCell>
                        {monthly.cats.map(c => {
                          const v = monthly.cell.get(`${m}|${c}`);
                          const med = v ? [...v.wins].sort((a, b) => a - b)[Math.floor(v.wins.length / 2)] : null;
                          return (
                            <TableCell key={c} className='text-right tabular-nums'>
                              {v ? <><b>{v.n}건</b><span className='text-muted-foreground'> · {med!.toFixed(2)}</span></>
                                : <span className='text-muted-foreground'>—</span>}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className='text-muted-foreground p-3 text-xs'>칸 = 건수 · 낙찰률 중앙값. 이 학교가 몇 월에 무엇을 내는지.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── 우측: 상시 산출기 ── */}
        <div className='space-y-4'>
          <Card className='xl:sticky xl:top-4'>
            <CardContent className='space-y-3 p-4'>
              <div className='font-semibold'>투찰 산출기</div>
              <div>
                <div className='text-muted-foreground mb-1 text-xs'>기초금액 (원){latest && ` · 기본값: 최근 회차`}</div>
                <Input value={base ? base.toLocaleString() : ''} onChange={e => setBaseStr(e.target.value)}
                  className='font-mono' inputMode='numeric' />
              </div>
              <div>
                <div className='text-muted-foreground mb-1 text-xs'>투찰률 — 차트·표 아무 곳이나 클릭해도 들어옵니다</div>
                <Input value={rateStr} onChange={e => { if (e.target.value.trim()) trackOnce('calc_input'); setRateStr(e.target.value); }}
                  placeholder={floor != null ? `예: ${(floor + 0.05).toFixed(2)}` : ''}
                  className='font-mono text-lg' inputMode='decimal' />
              </div>
              {amount != null && (
                <div className='text-lg tabular-nums'>= <b className='text-primary'>{won(amount)}원</b></div>
              )}
              {r != null && floor != null && r < floor && (
                <p className='text-destructive text-sm font-semibold'>공고 하한({floor}) 미만 · 무효</p>
              )}
              {verdicts && (
                <div className='text-[13px] tabular-nums'>
                  과거 {view.length}회 재생:{' '}
                  <b style={{ color: VCOLOR.밀림 }}>밀림 {verdicts.밀림}</b> ·{' '}
                  <b style={{ color: VCOLOR.낙찰 }}>낙찰 {verdicts.낙찰}</b> ·{' '}
                  <b style={{ color: VCOLOR.기회 }}>기회 {verdicts.기회}</b> ·{' '}
                  <b style={{ color: VCOLOR.무효 }}>무효 {verdicts.무효}</b>
                  <button className='text-primary ml-1 underline' onClick={() => setLens('rehearsal')}>상세</button>
                </div>
              )}
              {crowdN != null && crowd && (
                <p className='text-[13px] tabular-nums'>
                  이 값 자리에 최근 {crowd.days}일 <b className={crowdN > 200 ? 'text-destructive' : 'text-primary'}>{crowdN.toLocaleString()}건</b>
                  {crowdN === 0 ? ' — 빈 자리' : ''} <span className='text-muted-foreground'>(최근 {crowd.days}일 전장 {crowd.total.toLocaleString()}건의 사실 · 동가는 추첨)</span>
                </p>
              )}
              {base > 0 && floor != null && pprLo != null && pprHi != null && (
                <p className='text-muted-foreground text-xs tabular-nums'>
                  하한 금액은 예정가 추첨에 따라 {won(base * floor / 100 * pprLo / 100)}~{won(base * floor / 100 * pprHi / 100)}원
                  사이에서 정해져 왔습니다 (이 학교 {pprs.length}회 기준).
                </p>
              )}
              {openBids.length > 0 ? (
                <div className='space-y-1.5 border-t pt-2'>
                  <div className='text-sm font-medium'>진행 중 공고 {openBids.length}건</div>
                  {openBids.map(o => {
                    const m = marks[o.bidNo];
                    return (
                      <div key={o.bidNo} className='space-y-1'>
                        <Button className='w-full' size='sm' disabled={r == null || (o.floorRate != null && r < o.floorRate)}
                          variant={m?.s === 'done' ? 'secondary' : 'default'}
                          onClick={() => { if (m?.s !== 'done') trackAction('mark_done'); setMark(o.bidNo, m?.s === 'done' ? null : { s: 'done', rate: r ?? undefined }); }}>
                          {m?.s === 'done' ? `✓ ${o.category} 투찰함 (${m.rate ?? ''})` : `${o.category} 공고에 이 값 저장`}
                        </Button>
                        <Link href={`/dashboard/auction/${o.bidNo}`} className='text-primary block text-xs hover:underline'>
                          {o.category} · 기초 {won(o.basePrice)}원 · 하한 {o.floorRate} — 상세 →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className='text-muted-foreground border-t pt-2 text-xs'>진행 중 공고가 없습니다. 공고가 뜨면 여기서 바로 투찰함에 저장됩니다.</p>
              )}
              <a href='https://www.eat.co.kr' target='_blank' rel='noreferrer'
                className='text-muted-foreground block text-xs hover:underline'>공공급식통합플랫폼(NeaT)에서 투찰 →</a>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 하단: 진행 공고 + 로스터 */}
      {openBids.length > 0 && (
        <Card>
          <CardContent className='flex flex-wrap items-center gap-3 py-3'>
            <span className='font-medium'>진행 중 공고</span>
            {openBids.map(o => (
              <Link key={o.bidNo} href={`/dashboard/auction/${o.bidNo}`}
                className='text-primary text-sm hover:underline'>
                {o.category} · 기초 {won(o.basePrice)}원 · 하한 {o.floorRate} →
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className='p-0'>
          <div className='px-4 pt-3 font-semibold'>참여 업체</div>
          <RosterTable rows={roster.rows} limit={15} />
        </CardContent>
      </Card>
    </div>
  );
}
