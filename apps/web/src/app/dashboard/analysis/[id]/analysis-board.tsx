'use client';
/**
 * 분석판 — TradingView lightweight-charts 기반 회차 분석 터미널
 * 레이어: 낙찰률(메인) · 2등가 · 무효 확정 상한 · 참여 수(볼륨) · 내 투찰 마커 · 리허설 라인
 * 기준선: 하한 · 잘 나온 구간 상/하단. 점 클릭 → 개찰 리플레이(전 투찰 사다리)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, LineSeries, HistogramSeries, createSeriesMarkers,
  LineStyle, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { useWorkspace } from '@/lib/workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type Round = {
  bidId: string; openedAt: string; category: string | null; floorRate: number | null;
  winRate: number | null; basePrice: number | null; nValid: number;
  nBids: number | null; maxInvalid: number | null; secondRate: number | null;
};
type Replay = {
  meta: { openedAt: string | null; schoolName: string | null; basePrice: number | null;
    floorRate: number | null; winRate: number | null; n: number; nValid: number;
    gap12: number | null; maxInvalid: number | null } | null;
  bids: { bizNo: string; name: string; bidRate: number; won: boolean; status: string }[];
};

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();
const C = {
  win: '#149a80', second: '#e8a13a', invalid: '#8b5a5a', volume: 'rgba(120,130,125,0.45)',
  floor: '#e5484d', band: 'rgba(20,154,128,0.55)', me: '#2962ff', my: '#111111',
};

export function AnalysisBoard({ school, rounds }: { school: any; rounds: Round[] }) {
  const { bizNos } = useWorkspace();
  const floors = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rounds) if (r.floorRate != null && r.winRate != null)
      m.set(r.floorRate, (m.get(r.floorRate) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [rounds]);
  const [floor, setFloor] = useState<number | null>(null);
  useEffect(() => { if (floor == null && floors.length) setFloor(floors[0]); }, [floors, floor]);

  const [layers, setLayers] = useState({ second: true, invalid: true, volume: true, band: true });
  const [rehearsal, setRehearsal] = useState<string>('');
  const rVal = parseFloat(rehearsal);
  const r = Number.isFinite(rVal) ? rVal : null;

  // 내 투찰 (이 학교)
  const [my, setMy] = useState<{ openedAt: string | null; floorRate: number | null; bidRate: number | null; won: number }[]>([]);
  useEffect(() => {
    if (!school || bizNos.length === 0) return;
    fetch(`/api/schools/${encodeURIComponent(school.id)}/my-bids?bizNos=${bizNos.join(',')}`)
      .then(res => res.json()).then(setMy).catch(() => {});
  }, [school, bizNos]);

  const view = useMemo(() => {
    const rs = rounds.filter(x => x.floorRate === floor && x.winRate != null)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    // 동일 날짜 중복 → +1h 오프셋으로 시간 유일화
    let prev = ''; let dup = 0;
    return rs.map(x => {
      dup = x.openedAt === prev ? dup + 1 : 0; prev = x.openedAt;
      const t = (Date.parse(x.openedAt + 'T00:00:00Z') / 1000 + dup * 3600) as UTCTimestamp;
      return { ...x, t };
    });
  }, [rounds, floor]);

  const dense = useMemo(() => {
    const bf = (school?.byFloor ?? {}) as Record<string, any>;
    const st = floor != null ? (bf[String(floor)] ?? bf[floor?.toFixed(1) ?? '']) : null;
    return st?.dense ?? null;
  }, [school, floor]);

  // 리허설 판정: 밀림 확정 / 무효 확정 / 기회(낙찰 또는 무효)
  const verdicts = useMemo(() => {
    if (r == null) return null;
    let push = 0, dead = 0, alive = 0;
    for (const x of view) {
      if (r >= x.winRate!) push++;
      else if (x.maxInvalid != null && r <= x.maxInvalid) dead++;
      else alive++;
    }
    return { push, dead, alive, n: view.length };
  }, [r, view]);

  // 회랑 통계 (1-2등 간격)
  const gapMed = useMemo(() => {
    const g = view.filter(x => x.secondRate != null).map(x => +(x.secondRate! - x.winRate!).toFixed(3)).sort((a, b) => a - b);
    return g.length ? g[Math.floor(g.length / 2)] : null;
  }, [view]);

  // ── lightweight-charts ──
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Record<string, ISeriesApi<any>>>({});
  const [hover, setHover] = useState<Round | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  useEffect(() => {
    if (!elRef.current) return;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted-foreground').trim() || '#666';
    const border = css.getPropertyValue('--border').trim() || '#ddd';
    const chart = createChart(elRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: text, fontSize: 12,
        fontFamily: "'Geist Mono','Pretendard Variable',monospace" },
      grid: { vertLines: { color: 'rgba(127,127,127,0.08)' }, horzLines: { color: 'rgba(127,127,127,0.12)' } },
      rightPriceScale: { borderColor: border, scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: border, timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => p.toFixed(2) },
    });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = {}; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || floor == null) return;
    for (const s of Object.values(seriesRef.current)) chart.removeSeries(s);
    seriesRef.current = {};

    const win = chart.addSeries(LineSeries, {
      color: C.win, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      pointMarkersVisible: true, pointMarkersRadius: 3, title: '낙찰률',
    });
    win.setData(view.map(x => ({ time: x.t, value: x.winRate! })));
    seriesRef.current.win = win;

    // 기준선: 하한 · 구간 · 리허설
    win.createPriceLine({ price: floor, color: C.floor, lineWidth: 2, lineStyle: LineStyle.Solid, title: `하한 ${floor}` });
    if (layers.band && dense) {
      win.createPriceLine({ price: dense.lo, color: C.band, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `구간 ${dense.lo.toFixed(2)}` });
      win.createPriceLine({ price: dense.hi, color: C.band, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `구간 ${dense.hi.toFixed(2)}` });
    }
    if (r != null) {
      win.createPriceLine({ price: r, color: C.me, lineWidth: 2, lineStyle: LineStyle.LargeDashed, title: `내 값 ${r.toFixed(3)}` });
    }

    if (layers.second) {
      const s2 = chart.addSeries(LineSeries, {
        color: C.second, lineWidth: 1, lineStyle: LineStyle.Dotted,
        priceLineVisible: false, lastValueVisible: false, title: '2등가',
        pointMarkersVisible: true, pointMarkersRadius: 2,
      });
      s2.setData(view.filter(x => x.secondRate != null).map(x => ({ time: x.t, value: x.secondRate! })));
      seriesRef.current.s2 = s2;
    }
    if (layers.invalid) {
      const iv = chart.addSeries(LineSeries, {
        color: C.invalid, lineWidth: 1, lineStyle: LineStyle.Dotted,
        priceLineVisible: false, lastValueVisible: false, title: '무효 상한',
        pointMarkersVisible: true, pointMarkersRadius: 2,
      });
      iv.setData(view.filter(x => x.maxInvalid != null).map(x => ({ time: x.t, value: x.maxInvalid! })));
      seriesRef.current.iv = iv;
    }
    if (layers.volume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol', color: C.volume, priceFormat: { type: 'volume' }, title: '참여',
        priceLineVisible: false, lastValueVisible: false,
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(view.map(x => ({ time: x.t, value: x.nBids ?? x.nValid })));
      seriesRef.current.vol = vol;
    }
    // 내 투찰 마커
    const myPts = my.filter(m => m.floorRate === floor && m.bidRate != null && m.openedAt);
    if (myPts.length) {
      const byDate = new Map(view.map(x => [x.openedAt, x.t]));
      const markers = myPts.filter(m => byDate.has(m.openedAt!)).map(m => ({
        time: byDate.get(m.openedAt!)!, position: 'aboveBar' as const,
        color: m.won ? C.win : C.my, shape: 'arrowDown' as const,
        text: `내 ${m.bidRate!.toFixed(2)}`,
      }));
      createSeriesMarkers(win, markers);
    }
    chart.timeScale().fitContent();

    const onMove = (p: any) => {
      if (!p?.time) { setHover(null); return; }
      const x = view.find(v => v.t === p.time);
      setHover(x ?? null);
    };
    const onClick = async (p: any) => {
      if (!p?.time) return;
      const x = view.find(v => v.t === p.time);
      if (!x) return;
      setReplayLoading(true);
      try {
        const res = await fetch(`/api/rounds/${encodeURIComponent(x.bidId)}`);
        setReplay(await res.json());
      } finally { setReplayLoading(false); }
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.unsubscribeClick(onClick); };
  }, [view, layers, dense, floor, r, my]);

  if (!school) return <div className='p-8'>학교를 찾지 못했습니다.</div>;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <div className='text-muted-foreground text-xs'>{school.sido} {school.sigungu} · 분석판</div>
          <h1 className='text-xl font-semibold'>{school.name}</h1>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {floors.map(f => (
            <Button key={f} size='sm' variant={floor === f ? 'default' : 'outline'}
              onClick={() => { setFloor(f); setReplay(null); }}>하한 {f}</Button>
          ))}
        </div>
      </div>

      {/* 통계 스트립 */}
      <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
        <Card><CardContent className='px-4 py-3'>
          <div className='text-muted-foreground text-xs'>회차</div>
          <div className='text-lg font-bold tabular-nums'>{view.length}회</div>
        </CardContent></Card>
        <Card><CardContent className='px-4 py-3'>
          <div className='text-muted-foreground text-xs'>잘 나온 구간</div>
          <div className='text-lg font-bold tabular-nums'>{dense ? `${dense.lo.toFixed(2)}–${dense.hi.toFixed(2)}` : '—'}</div>
        </CardContent></Card>
        <Card><CardContent className='px-4 py-3'>
          <div className='text-muted-foreground text-xs'>1–2등 간격 (중앙값)</div>
          <div className='text-lg font-bold tabular-nums'>{gapMed != null ? gapMed.toFixed(3) : '—'}</div>
        </CardContent></Card>
        <Card><CardContent className='px-4 py-3'>
          <div className='text-muted-foreground text-xs'>최근 낙찰</div>
          <div className='text-lg font-bold tabular-nums'>{view.at(-1)?.winRate?.toFixed(3) ?? '—'}</div>
        </CardContent></Card>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_340px]'>
        <Card>
          <CardContent className='p-3'>
            {/* 레이어 토글 + 리허설 */}
            <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
              <div className='flex flex-wrap gap-1.5 text-xs'>
                <Badge variant='outline' style={{ borderColor: C.win, color: C.win }}>― 낙찰률</Badge>
                {([['second', '2등가', C.second], ['invalid', '무효 상한', C.invalid], ['volume', '참여 수', '#889'], ['band', '구간', C.band]] as const).map(([k, label, color]) => (
                  <button key={k}
                    className='rounded border px-2 py-0.5'
                    style={layers[k] ? { borderColor: color, color } : { opacity: 0.4 }}
                    onClick={() => setLayers(l => ({ ...l, [k]: !l[k] }))}>
                    {layers[k] ? '―' : '·'} {label}
                  </button>
                ))}
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground text-xs'>리허설</span>
                <Input value={rehearsal} onChange={e => setRehearsal(e.target.value)}
                  placeholder={floor != null ? `${(floor + 0.05).toFixed(2)}` : ''}
                  className='h-8 w-28 font-mono' inputMode='decimal' />
              </div>
            </div>
            <div ref={elRef} style={{ height: 460 }} />
            {/* 크로스헤어 정보 */}
            <div className='text-muted-foreground mt-2 flex min-h-[22px] flex-wrap gap-x-4 text-[13px] tabular-nums'>
              {hover ? (<>
                <span className='text-foreground font-semibold'>{hover.openedAt}</span>
                <span>{hover.category}</span>
                <span>기초 {won(hover.basePrice)}원</span>
                <span style={{ color: C.win }}>낙찰 {hover.winRate?.toFixed(3)}</span>
                {hover.secondRate != null && <span style={{ color: C.second }}>2등 {hover.secondRate.toFixed(3)} (+{(hover.secondRate - hover.winRate!).toFixed(3)})</span>}
                {hover.maxInvalid != null && <span style={{ color: C.invalid }}>무효 상한 {hover.maxInvalid.toFixed(3)}</span>}
                <span>참여 {hover.nBids ?? hover.nValid}곳</span>
                <span className='text-primary'>클릭 → 개찰 리플레이</span>
              </>) : '점 위에서 회차 정보 · 클릭하면 그 회차 전체 투찰이 열립니다'}
            </div>
            {/* 리허설 판정 */}
            {verdicts && (
              <div className='mt-3 grid grid-cols-3 gap-2 text-center'>
                <div className='rounded border px-2 py-2'>
                  <div className='text-lg font-bold tabular-nums' style={{ color: C.second }}>{verdicts.push}회</div>
                  <div className='text-muted-foreground text-xs'>밀림 확정 (낙찰가보다 높음)</div>
                </div>
                <div className='rounded border-2 px-2 py-2' style={{ borderColor: C.me }}>
                  <div className='text-lg font-bold tabular-nums' style={{ color: C.me }}>{verdicts.alive}회</div>
                  <div className='text-muted-foreground text-xs'>낙찰 기회 (낙찰 또는 무효 — 예정가 추첨이 가름)</div>
                </div>
                <div className='rounded border px-2 py-2'>
                  <div className='text-lg font-bold tabular-nums' style={{ color: C.invalid }}>{verdicts.dead}회</div>
                  <div className='text-muted-foreground text-xs'>무효 확정 (무효 상한보다 낮음)</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 개찰 리플레이 */}
        <Card>
          <CardContent className='p-4'>
            <div className='mb-2 font-semibold'>개찰 리플레이</div>
            {replayLoading && <div className='text-muted-foreground text-sm'>불러오는 중…</div>}
            {!replay && !replayLoading && (
              <div className='text-muted-foreground text-sm'>차트에서 회차를 클릭하면 그날 전체 업체의 투찰이 낮은 값부터 표시됩니다.</div>
            )}
            {replay?.meta && (
              <div className='space-y-2'>
                <div className='text-sm tabular-nums'>
                  <b>{replay.meta.openedAt}</b> · 기초 {won(replay.meta.basePrice)}원 · {replay.meta.n}곳
                  {replay.meta.gap12 != null && <> · 1–2등 <b style={{ color: C.second }}>{replay.meta.gap12.toFixed(3)}</b> 차</>}
                </div>
                <div className='max-h-[430px] space-y-px overflow-y-auto text-[13px] tabular-nums'>
                  {replay.bids.map((b, i) => (
                    <div key={b.bizNo} className={`flex items-center justify-between rounded px-2 py-1 ${b.won ? 'font-bold' : ''}`}
                      style={{
                        background: b.won ? 'rgba(20,154,128,0.14)' : b.status === '하한미달' ? 'rgba(139,90,90,0.10)' : undefined,
                        color: b.status === '하한미달' ? C.invalid : undefined,
                      }}>
                      <span className='truncate pr-2'>{i + 1}. {b.name}</span>
                      <span className='flex shrink-0 items-center gap-2'>
                        <span className='font-mono'>{b.bidRate.toFixed(3)}</span>
                        <span className='text-xs'>{b.won ? '낙찰' : b.status}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
