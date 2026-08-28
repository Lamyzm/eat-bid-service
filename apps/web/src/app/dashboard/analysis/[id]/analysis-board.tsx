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
import { usePersistedFlag, usePersistedChoice } from '@/lib/use-persisted-state';
import { won } from '@/lib/format';
import { monthsAgoKST, type ForecastRow } from '@eatbid/shared';
import { deadlineText } from '@/lib/deadline';
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
const LENS_KEYS = LENSES.map(([k]) => k);
type Lens = typeof LENSES[number][0];
/** 상시 노출 렌즈 (B) — 나머지는 '더보기' */
const PRIMARY_LENSES: string[] = ['record', 'flow', 'rehearsal'];
const PERIODS = [['3m', '3개월', 3], ['6m', '6개월', 6], ['12m', '12개월', 12], ['all', '전체', 999]] as const;

/** 판정: 실효하한 보유 회차는 확정, 미보유는 경계 기반 */
function verdictOf(r: number, x: Round): '밀림' | '낙찰' | '기회' | '무효' {
  if (x.winRate == null) return '기회';
  if (r >= x.winRate) return '밀림';
  if (x.effFloor != null) return r < x.effFloor ? '무효' : '낙찰';
  if (x.maxInvalid != null && r <= x.maxInvalid) return '무효';
  return '기회';
}
/** 판정색 — 접근 시점에 다크/라이트 분기 (모듈 상수로 굳히면 테마 전환을 못 따라간다) */
const vcolor = (k: '밀림' | '낙찰' | '기회' | '무효') =>
  ({ 밀림: C.second, 낙찰: C.win, 기회: C.me, 무효: C.invalid })[k];

/** 호버-리플레이 세션 캐시 — 같은 회차 재호버 시 무요청 (D 티켓) */
const replayCache = new Map<string, Replay>();

/** 기준선 세로 점선 + 라벨. 라벨은 좌우 번갈아 앵커해 1280에서도 겹치지 않는다 */
function MarkLines({ marks, X, top, bottom, clipL, clipR }: {
  marks: { v: number; label: string; color: string }[];
  X: (v: number) => number; top: number; bottom: number; clipL: number; clipR: number;
}) {
  return (<>
    {marks.map((m, i) => {
      const x = X(m.v);
      if (x < clipL || x > clipR) return null;
      // 가장자리에선 라벨을 안쪽으로 — 축 눈금과 겹치지 않게
      const flip = x - clipL < 70 ? true : clipR - x < 70 ? false : i % 2 === 1;
      return (
        <g key={`m-${i}`}>
          <line x1={x} y1={top} x2={x} y2={bottom} stroke={m.color} strokeWidth={1.8} strokeDasharray='5 3' />
          <text x={x + (flip ? 5 : -5)} y={top + 12} textAnchor={flip ? 'start' : 'end'} fontSize={12}
            fill={m.color} fontFamily='var(--font-mono, monospace)'>{m.label}</text>
        </g>
      );
    })}
  </>);
}

/**
 * 범용 분포 차트 — 막대 클릭 배선.
 * 문법은 공고 상세 strip-chart와 통일: 옅은 그리드+y눈금, primary 막대,
 * 잘 나온 구간 = primary 음영, 기준선 = 색 점선 + 모노 라벨, n 명시.
 * 표본 12 미만이면 막대 대신 점 스트립 — 전부 1회짜리 막대는 정보가 없다.
 * 높이는 고정 px (viewBox 축소 스케일로 159px까지 납작해지던 문제).
 */
function Hist({ values, binSize, fmt, highlight, onBar, marks }: {
  values: number[]; binSize: number; fmt: (v: number) => string;
  highlight?: [number, number] | null; onBar?: (lo: number, hi: number) => void;
  marks?: { v: number; label: string; color: string }[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(620);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(es => {
      const w = es[0]?.contentRect.width;
      if (w) setCw(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (values.length === 0) return <p className='text-muted-foreground py-6 text-sm'>표본이 없습니다.</p>;

  const small = values.length < 12;
  const W = Math.max(420, cw), H = small ? 220 : 280, L = 40, R = 14, B = 40, T = 18;
  const lo = Math.floor(Math.min(...values) / binSize) * binSize;
  const hi = Math.ceil((Math.max(...values) + 1e-9) / binSize) * binSize;
  const span = Math.max(hi - lo, binSize);
  const Xv = (v: number) => L + (v - lo) / span * (W - L - R);
  const mono = 'var(--font-mono, monospace)';

  if (small) {
    // 점 스트립 — 같은 값(binSize 반올림) 스택, ×n 라벨
    const stacks = new Map<number, number>();
    for (const v of values) {
      const k = Math.round(v / binSize) * binSize;
      stacks.set(k, (stacks.get(k) ?? 0) + 1);
    }
    const base = H - B;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += binSize) ticks.push(Math.round(v / binSize) * binSize);
    let lastLbl = -Infinity;
    return (
      <div ref={wrapRef} style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} role='img'>
          {highlight && (
            <rect x={Math.max(L, Xv(highlight[0]))} y={T}
              width={Math.min(W - R, Xv(highlight[1])) - Math.max(L, Xv(highlight[0]))} height={base - T}
              fill='var(--primary)' opacity={0.09} />
          )}
          <line x1={L} y1={base} x2={W - R} y2={base} stroke='var(--border)' />
          {ticks.map(v => {
            const x = Xv(v); const show = x - lastLbl >= 52; if (show) lastLbl = x;
            return (
              <g key={v}>
                <line x1={x} y1={base} x2={x} y2={base + 5} stroke='var(--border)' />
                {show && <text x={x} y={base + 20} textAnchor='middle' fontSize={12}
                  fill='var(--muted-foreground)' fontFamily={mono}>{fmt(v)}</text>}
              </g>
            );
          })}
          {[...stacks.entries()].map(([k, n]) => (
            <g key={k} style={{ cursor: onBar ? 'pointer' : undefined }}
              onClick={() => onBar?.(k - binSize / 2, k + binSize / 2)}>
              {Array.from({ length: n }, (_, i) => (
                <circle key={i} cx={Xv(k)} cy={base - 12 - i * 15} r={6}
                  fill='var(--primary)' opacity={0.8}>
                  <title>{fmt(k)} · {n}회{onBar ? ' · 클릭=산출기 적용' : ''}</title>
                </circle>
              ))}
              {n >= 2 && <text x={Xv(k)} y={base - 12 - n * 15 - 4} textAnchor='middle' fontSize={12}
                fontWeight={700} fill='var(--foreground)' fontFamily={mono}>×{n}</text>}
            </g>
          ))}
          {marks && <MarkLines marks={marks} X={Xv} top={T} bottom={base} clipL={L} clipR={W - R} />}
          <text x={W - R} y={12} textAnchor='end' fontSize={12} fill='var(--muted-foreground)'>{values.length}회</text>
        </svg>
      </div>
    );
  }

  const nBins = Math.max(1, Math.round((hi - lo) / binSize));
  const bins = Array.from({ length: nBins }, (_, i) => ({
    lo: +(lo + i * binSize).toFixed(6), hi: +(lo + (i + 1) * binSize).toFixed(6), n: 0,
  }));
  for (const v of values) {
    const i = Math.min(nBins - 1, Math.floor((v - lo) / binSize));
    bins[i].n++;
  }
  const maxN = Math.max(...bins.map(b => b.n));
  const bw = (W - L - R) / nBins;
  const X = (i: number) => L + i * bw;
  const Y = (n: number) => T + (H - T - B) * (1 - n / maxN);
  // y 눈금 3~4개 — "13과 8이 얼마나 다른가"를 축으로 읽게 한다
  const yStep = Math.max(1, Math.ceil(maxN / 4));
  const yTicks: number[] = [];
  for (let n = yStep; n <= maxN; n += yStep) yTicks.push(n);
  let lastLbl = -Infinity;
  return (
    <div ref={wrapRef} style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} role='img'>
        {/* 잘 나온 구간 음영 (primary 8~10% — strip-chart와 동일 문법) */}
        {highlight && (
          <rect x={Math.max(L, Xv(highlight[0]))} y={T}
            width={Math.min(W - R, Xv(highlight[1])) - Math.max(L, Xv(highlight[0]))} height={H - B - T}
            fill='var(--primary)' opacity={0.09} />
        )}
        {/* y축 그리드 + 눈금 */}
        {yTicks.map(n => (
          <g key={n}>
            <line x1={L} y1={Y(n)} x2={W - R} y2={Y(n)} stroke='var(--border)' opacity={0.55} />
            <text x={L - 6} y={Y(n) + 4} textAnchor='end' fontSize={12}
              fill='var(--muted-foreground)' fontFamily={mono}>{n}</text>
          </g>
        ))}
        <line x1={L} y1={T} x2={L} y2={H - B} stroke='var(--border)' />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke='var(--border)' />
        {bins.map((b, i) => {
          const hot = highlight && b.hi > highlight[0] && b.lo < highlight[1];
          return (
            <g key={i} style={{ cursor: onBar && b.n ? 'pointer' : undefined }}
              onClick={() => b.n && onBar?.(b.lo, b.hi)}>
              <rect x={X(i) + 1.5} y={Y(b.n)} width={Math.max(1, bw - 3)} height={H - B - Y(b.n)}
                fill='var(--primary)' opacity={hot ? 0.95 : 0.5} rx={2}>
                <title>{fmt(b.lo)}~{fmt(b.hi)} · {b.n}회{onBar ? ' · 클릭=산출기 적용' : ''}</title>
              </rect>
              {b.n > 0 && bw >= 18 && <text x={X(i) + bw / 2} y={Y(b.n) - 4} textAnchor='middle' fontSize={12}
                fill='var(--foreground)' fontFamily={mono}>{b.n}</text>}
            </g>
          );
        })}
        {bins.map((b, i) => {
          const x = X(i); const show = x - lastLbl >= 46; if (show) lastLbl = x;
          return show ? (
            <text key={`l-${i}`} x={x} y={H - B + 16} fontSize={12} textAnchor='middle'
              fill='var(--muted-foreground)' fontFamily={mono}>{fmt(b.lo)}</text>
          ) : null;
        })}
        {marks && <MarkLines marks={marks} X={Xv} top={T} bottom={H - B} clipL={L} clipR={W - R} />}
        <text x={W - R} y={12} textAnchor='end' fontSize={12} fill='var(--muted-foreground)'>{values.length}회</text>
      </svg>
    </div>
  );
}

export function AnalysisBoard({ school, rounds, initialRate, initialBase, initialBidNo }: {
  school: any; rounds: Round[]; initialRate?: string | null; initialBase?: string | null;
  initialBidNo?: string | null;
}) {
  const { bizNos } = useWorkspace();
  const { marks, set: setMark } = useMarks();
  useTrack('analysis');
  // 렌즈 기억: 최초 방문=흐름, 이후 마지막 사용 렌즈
  const [lens, setLens] = usePersistedChoice<Lens>('eatbid.lens', 'flow', LENS_KEYS);
  const [period, setPeriod] = useState<'3m' | '6m' | '12m' | 'all'>('all');
  // 하한·기간 펼침 (B) — 상태 기억
  const [scopeOpen, setScopeOpen] = usePersistedFlag('eatbid.scopeOpen');
  const [moreLens, setMoreLens] = usePersistedFlag('eatbid.moreLens');
  // 공고 컨텍스트 (IA 3안) — bidNo가 있으면 그 공고 기준으로 산출기·하한 탭 세팅
  const [ctxBid, setCtxBid] = useState<any>(null);
  const ctxAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialBidNo) return;
    fetch(`/api/open/${encodeURIComponent(initialBidNo)}`).then(r => r.json())
      .then(d => { if (d && d.bidNo) setCtxBid(d); }).catch(() => {});
  }, [initialBidNo]);


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
    return monthsAgoKST(months);
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
  // 공고 컨텍스트 도착 시 1회 적용 — 기초금액·하한 탭
  useEffect(() => {
    if (!ctxBid || ctxAppliedRef.current) return;
    ctxAppliedRef.current = true;
    if (ctxBid.basePrice != null) setBaseStr(String(ctxBid.basePrice));
    if (ctxBid.floorRate != null) setFloor(ctxBid.floorRate);
  }, [ctxBid]);
  useEffect(() => { if (!baseStr && latest?.basePrice) setBaseStr(String(latest.basePrice)); }, [latest]);
  const base = Number(baseStr.replace(/[^0-9]/g, '')) || 0;
  const [rateStr, setRateStr] = useState(initialRate ?? '');
  // 저장값 복원 — 마운트 후 1회 (URL rate 우선, 없으면 그 공고의 저장값)
  const rateSeededRef = useRef(false);
  useEffect(() => {
    if (rateSeededRef.current || initialRate) { rateSeededRef.current = true; return; }
    const saved = ctxBid ? marks[ctxBid.bidNo]?.rate : undefined;
    if (saved != null) { rateSeededRef.current = true; setRateStr(String(saved)); }
  }, [ctxBid, marks, initialRate]);
  const rate = parseFloat(rateStr);
  const r = Number.isFinite(rate) ? rate : null;
  const inject = (v: number) => setRateStr(v.toFixed(3));
  const amount = r != null && base ? Math.round(base * r / 100) : null;

  // 몰림 — 전국 최근 14일 투찰값 분포 (산출기 한 줄)
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
  /**
   * 발주 예보 — 서버 값을 그대로 쓴다.
   * 같은 알고리즘을 웹이 다시 구현하고 있었고 기준 시각만 달라서(서버는 자정, 웹은 현재 시각)
   * 같은 학교의 D-day 가 오늘 화면과 여기서 하루씩 어긋났다.
   */
  const [forecast, setForecast] = useState<ForecastRow | null>(null);
  useEffect(() => {
    const sgg = school?.sigungu;
    if (!sgg || !school?.id) return;
    const ac = new AbortController();
    fetch(`/api/schools/forecast?sigungu=${encodeURIComponent(sgg)}`, { signal: ac.signal })
      .then(r => r.json())
      .then((rows: ForecastRow[]) => {
        if (!Array.isArray(rows)) return;
        setForecast(rows.find(f => f.schoolId === school.id) ?? null);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [school?.sigungu, school?.id]);

  if (!school) return <div className='p-8'>학교를 찾지 못했습니다.</div>;
  const openBid = openBids[0] ?? null;
  const mark = openBid ? marks[openBid.bidNo] : null;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      {/* 헤더 + 사실 칩 */}
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <div className='text-muted-foreground text-xs'>{school.sido} {school.sigungu} · 분석판</div>
          <h1 className='text-2xl font-semibold'>{school.name}</h1>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            <Badge variant='secondary'>공고 {rounds.length}건</Badge>
            <Badge variant='secondary'>예정가 보유 {rounds.filter(x => x.plannedPrice != null).length}회</Badge>
            {openBid && <Badge>진행 중 공고 {openBids.length}건</Badge>}
            {my.length > 0 && <Badge variant='outline'>내 참여 {my.length}회</Badge>}
            {!openBid && forecast && (
              <Badge variant='outline' className='tabular-nums'>
                발주 주기 {forecast.medGapDays}일 · 다음 예상 {forecast.dueInDays <= 0 ? '도래' : `${forecast.expected} (D-${forecast.dueInDays})`}
              </Badge>
            )}
          </div>
        </div>
        <div>
          <button type='button' onClick={() => setScopeOpen(v => !v)}
            className='text-muted-foreground hover:text-foreground text-sm tabular-nums'>
            하한 {floor ?? '-'} · {PERIODS.find(pp => pp[0] === period)?.[1]} · {view.length}회 기준
            <span className='ml-1 text-xs'>{scopeOpen ? '▲' : '▼ 바꾸기'}</span>
          </button>
          {scopeOpen && (
            <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
              {floors.map(f => (
                <Button key={f} size='sm' variant={floor === f ? 'default' : 'outline'}
                  onClick={() => { setFloor(f); setReplayId(null); }}>하한 {f}</Button>
              ))}
              <span className='mx-1' />
              {PERIODS.map(([k, label]) => (
                <Button key={k} size='sm' variant={period === k ? 'default' : 'outline'}
                  onClick={() => setPeriod(k as any)}>{label}</Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {ctxBid && (
        <Card className='border-primary'>
          <CardContent className='flex flex-wrap items-center justify-between gap-3 py-3 text-[15px] tabular-nums'>
            <span>
              <b>진행 중 공고 기준</b> · {ctxBid.category ?? '-'} · 기초 {won(ctxBid.basePrice)}원 · 하한 {ctxBid.floorRate}
              {(() => {
                const t = deadlineText(ctxBid.deadline);
                return t ? <span className='text-destructive'> · {t}</span> : null;
              })()}
            </span>
            <Link href={`/dashboard/auction/${ctxBid.bidNo}${r != null ? `?rate=${r}` : ''}`}
              className='text-primary text-sm font-semibold hover:underline'>공고 상세로 →</Link>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-4 xl:grid-cols-[1fr_320px]'>
        {/* ── 메인: 렌즈 ── */}
        <Card>
          <CardContent className='p-3'>
            <div className='mb-3 flex gap-1 overflow-x-auto pb-1' style={{ scrollbarWidth: 'thin' }}>
              {LENSES.filter(([k]) => PRIMARY_LENSES.includes(k) || moreLens || lens === k).map(([k, label]) => (
                <Button key={k} size='sm' className='shrink-0' variant={lens === k ? 'default' : 'ghost'}
                  onClick={() => setLens(k)}>{label}</Button>
              ))}
              <Button size='sm' variant='ghost' className='text-muted-foreground shrink-0'
                onClick={() => setMoreLens(v => !v)}>
                {moreLens ? '접기' : `+ 더보기 (${LENSES.length - PRIMARY_LENSES.length})`}
              </Button>
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
                    {hoverLadder.bids.length > 5 && <span className='text-muted-foreground'>… 외 {hoverLadder.bids.length - 5}곳 · 클릭=전체</span>}
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
                막대 클릭 = 0.01 단위 확대 · 확대 후 클릭 = 산출기 적용 · 음영·짙은 막대 = 잘 나온 구간
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
                        const c = monthsAgoKST(mo);
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
                  우측 산출기에 값을 넣으면 과거 {view.length}회가 그 값이었을 때 어떻게 됐을지 보여줍니다.
                </p>
              ) : (<>
                <div className='mb-3 grid grid-cols-2 gap-2 text-center md:grid-cols-4'>
                  {(['밀림', '낙찰', '기회', '무효'] as const).map(k => (
                    <div key={k} className='rounded border px-2 py-2' style={k === '낙찰' ? { borderColor: C.win, borderWidth: 2 } : {}}>
                      <div className='text-muted-foreground mb-0.5 text-xs'>{k === '무효' ? '하한 아래' : k}</div>
                      {/* 히어로 숫자 — 화면당 1개: 리허설 낙찰 수 (DESIGN C표) */}
                      <div className={`${k === '낙찰' ? 'text-3xl' : 'text-xl'} font-bold tabular-nums`} style={{ color: vcolor(k) }}>{verdicts?.[k] ?? 0}회</div>
                      <div className='text-muted-foreground text-xs'>
                        {k === '밀림' && '내 값이 낙찰가 이상'}
                        {k === '낙찰' && '내 값이 실효하한~낙찰가 사이'}
                        {k === '기회' && '예정가 미보유 회차'}
                        {k === '무효' && '내 값이 실효하한 아래'}
                      </div>
                    </div>
                  ))}
                </div>
                <p className='text-muted-foreground mb-2 text-xs'>발주처가 주는 값은 낙찰과 낙찰실패 둘뿐입니다. 하한 아래인지는 저희가 계산한 관찰입니다.</p>
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
                            <TableCell><b style={{ color: vcolor(v) }}>{v}</b></TableCell>
                            <TableCell>
                              <details className='text-xs'>
                                <summary className='text-muted-foreground cursor-pointer'>보기</summary>
                                <div className='text-muted-foreground mt-1 font-mono'>
                                  {x.effFloor != null
                                    ? `실효하한 = ${x.floorRate} × 예정가 ${won(x.plannedPrice)} ÷ 기초 ${won(x.basePrice)} = ${x.effFloor.toFixed(3)}. `
                                    : '이 회차는 예정가 미보유 → 관찰 상한 기준. '}
                                  내 {r.toFixed(3)} {v === '밀림' ? `≥ 낙찰 ${x.winRate!.toFixed(3)} → 밀림`
                                    : v === '낙찰' ? `< 낙찰 ${x.winRate!.toFixed(3)}, ≥ 실효하한 → 낙찰`
                                    : v === '무효' ? `< 하한 경계 → 하한 아래` : `< 낙찰 — 예정가 추첨이 가름`}
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
                  과거 사실이며 다음 회차의 결과 예측이 아닙니다. 예정가는 매회 추첨으로 새로 정해집니다.
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
              <div className='mb-1 text-sm font-medium'>복수예가 분포 <span className='text-muted-foreground font-normal'>· 회차마다 15개가 공개되고 4개가 추첨됩니다</span></div>
              <Hist values={reserveRatios} binSize={0.5} fmt={v => v.toFixed(1)}
                marks={pprLo != null && pprHi != null ? [
                  { v: pprLo, label: `예정가율 5% ${pprLo.toFixed(2)}`, color: C.me },
                  { v: pprHi, label: `95% ${pprHi.toFixed(2)}`, color: C.me },
                ] : []} />
              <div className='mb-1 mt-4 text-sm font-medium'>실제 예정가율(추첨 결과) 분포</div>
              <Hist values={pprs} binSize={0.2} fmt={v => v.toFixed(1)} />
              {base > 0 && floor != null && pprLo != null && pprHi != null && (
                <p className='mt-2 text-sm tabular-nums'>
                  기초금액 {won(base)}원 기준 · 이 학교 예정가율 90%가{' '}
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
                <div className='text-muted-foreground mb-1 text-xs'>투찰률 (차트·표 아무 곳이나 클릭해도 들어옵니다)</div>
                <Input value={rateStr} onChange={e => { if (e.target.value.trim()) trackOnce('calc_input'); setRateStr(e.target.value); }}
                  placeholder={floor != null ? `예: ${(floor + 0.05).toFixed(2)}` : ''}
                  className='font-mono text-lg' inputMode='decimal' />
              </div>
              {amount != null && (
                <div className='text-lg tabular-nums'>
                  <span className='text-muted-foreground text-xs'>내가 넣을 금액 </span>
                  <b className='text-primary'>{won(amount)}원</b>
                </div>
              )}
              {r != null && floor != null && r < floor && (
                <p className='text-destructive text-sm font-semibold'>공고 하한({floor}) 아래입니다</p>
              )}
              {verdicts && (
                <div className='text-[13px] leading-relaxed tabular-nums'>
                  이 값이면 과거 {view.length}회 중:{' '}
                  남이 더 낮게 써서 밀린 게 <b style={{ color: vcolor('밀림') }}>{verdicts.밀림}회</b> ·{' '}
                  내가 먹었을 게 <b style={{ color: vcolor('낙찰') }}>{verdicts.낙찰}회</b>
                  {verdicts.기회 > 0 && <> · 예정가 추첨이 갈랐을 게 <b style={{ color: vcolor('기회') }}>{verdicts.기회}회</b></>} ·{' '}
                  내 값이 하한 아래였던 게 <b style={{ color: vcolor('무효') }}>{verdicts.무효}회</b>
                  <button className='text-primary ml-1 underline' onClick={() => setLens('rehearsal')}>상세</button>
                </div>
              )}
              {crowdN != null && crowd && (
                <p className='text-[13px] tabular-nums'>
                  이 값 자리에 최근 {crowd.days}일 <b className={crowdN > 200 ? 'text-destructive' : 'text-primary'}>{crowdN.toLocaleString()}건</b>
                  {crowdN === 0 ? ' · 빈 자리' : ''} <span className='text-muted-foreground'>(전국 최근 {crowd.days}일 {crowd.total.toLocaleString()}건 기준 · 같은 값은 추첨)</span>
                </p>
              )}
              {base > 0 && floor != null && pprLo != null && pprHi != null && (
                <p className='text-muted-foreground text-xs tabular-nums'>
                  하한 금액은 예정가 추첨에 따라 {won(base * floor / 100 * pprLo / 100)}~{won(base * floor / 100 * pprHi / 100)}원
                  사이에서 정해져 왔습니다 (이 학교 {pprs.length}회 기준).
                </p>
              )}
              {(ctxBid ? [ctxBid, ...openBids.filter(o => o.bidNo !== ctxBid.bidNo)] : openBids).length > 0 ? (
                <div className='space-y-1.5 border-t pt-2'>
                  <div className='text-sm font-medium'>진행 중 공고 {(ctxBid ? [ctxBid, ...openBids.filter(o => o.bidNo !== ctxBid.bidNo)] : openBids).length}건</div>
                  {(ctxBid ? [ctxBid, ...openBids.filter(o => o.bidNo !== ctxBid.bidNo)] : openBids).map(o => {
                    const m = marks[o.bidNo];
                    return (
                      <div key={o.bidNo} className='space-y-1'>
                        {(() => {
                          const saved = m?.s === 'done';
                          const changed = saved && r != null && r !== m?.rate;
                          return (
                            <Button className='w-full' size='sm' disabled={r == null || (o.floorRate != null && r < o.floorRate)}
                              variant={saved && !changed ? 'secondary' : 'default'}
                              onClick={() => {
                                const v = r ?? m?.rate;
                                trackAction(!saved ? 'mark_done' : 'mark_update',
                                  { bidNo: o.bidNo, rate: v ?? undefined, from: 'analysis' });
                                setMark(o.bidNo, { s: 'done', rate: v });
                              }}>
                              {!saved ? `${o.category} 공고에 이 값 저장`
                                : changed ? `${o.category} — 이 값으로 갱신`
                                : `✓ ${o.category} 저장됨 (${m?.rate ?? ''})`}
                            </Button>
                          );
                        })()}
                        {m?.s === 'done' && (
                          <button className='text-muted-foreground text-xs hover:underline'
                            onClick={() => {
                              trackAction('mark_undone', { bidNo: o.bidNo, rate: m?.rate, from: 'analysis' });
                              setMark(o.bidNo, { s: 'watch', rate: m?.rate });
                            }}>저장 해제</button>
                        )}
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

      {/* 하단: 참여 업체 */}
      <Card>
        <CardContent className='p-0'>
          <div className='px-4 pt-3 font-semibold'>참여 업체</div>
          <RosterTable rows={roster.rows} limit={15} emptyText='이 학교는 아직 참여 기록이 없습니다' />
        </CardContent>
      </Card>
    </div>
  );
}
