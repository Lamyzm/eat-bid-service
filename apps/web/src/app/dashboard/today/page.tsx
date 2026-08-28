'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useRegion } from '@/lib/region';
import { useSession } from '@/lib/session';
import { RegionStatus } from '@/components/region-status';
import { RateInput } from '@/components/rate-input';
import { slotKeys, ratesOf, rateOf, withRate, primaryRate, hasAnyRate, sameRates } from '@/lib/mark-rates';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarks } from '@/lib/marks';
import { useTrack, trackAction, trackOnce, todayKey } from '@/lib/track';
import { won } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';


type OpenRow = {
  bidNo: string; schoolName: string | null; sigungu: string | null; schoolId: string | null;
  basePrice: number | null; floorRate: number | null; deadline: string | null; category: string | null;
  anchorAmount: number | null;
  band: { dense?: { lo: number; hi: number; pct: number } } | null;
  recent3: number[]; usualN: number | null;
};
type ResultRow = { bidNo: string; schoolName: string | null; openedAt: string | null; winRate: number | null; status: string };
type ForecastRow = { schoolId: string; schoolName: string; lastOpened: string; medGapDays: number; expected: string; dueInDays: number; lastWinRate: number | null };

function dday(deadline: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms < 0) return '마감됨';
  const h = Math.floor(ms / 36e5);
  return h < 24 ? `마감 ${h}시간 전` : `마감 D-${Math.floor(h / 24)}`;
}

export default function TodayPage() {
  const { bizNos, ready } = useWorkspace();
  const { homes, viewRegions, view, isBrowsing } = useRegion();
  const { ready: sessionReady } = useSession();
  const { marks, set } = useMarks();
  // 저장 시점 값 — '이 값으로 갱신' 판별용
  const [savedRates, setSavedRates] = useState<Record<string, Record<string, number>>>({});
  // 사업자 이름 — 2칸일 때 어느 칸이 누구인지 (U9)
  const [bizNames, setBizNames] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const bz of bizNos) {
      if (bizNames[bz]) continue;
      fetch(`/api/firms/lookup?bizNo=${bz}`).then(r => r.json())
        .then(d => { if (d?.name) setBizNames(v => ({ ...v, [bz]: d.name })); }).catch(() => {});
    }
  }, [bizNos.join(',')]);
  const slots = slotKeys(bizNos);
  const bizLabel = (bz: string) => bz === '' ? '' : (bizNames[bz] ?? `…${bz.slice(-4)}`);
  const focusSlot = (id: string) => {
    const el = document.querySelector<HTMLInputElement>(`[data-rate-slot="${id}"]`);
    if (el) { el.focus(); el.select?.(); }
  };
  useTrack('today');
  // 데일리 브리핑 — 어제 전국 개찰 (사실 카운트만)
  const [brief, setBrief] = useState<{ day: string; n: number; top: string | null; topN: number; isYesterday: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/wins/recent?days=2&limit=1000').then(r => r.json()).then(d => {
      const rows: any[] = Array.isArray(d) ? d : (d.rows ?? []);
      if (rows.length === 0) { setBrief(null); return; }
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      let day = yesterday;
      let dayRows = rows.filter(r => r.openedAt === yesterday);
      if (dayRows.length === 0) {
        day = rows[0].openedAt; // 최신 개찰일 (desc 정렬)
        dayRows = rows.filter(r => r.openedAt === day);
      }
      const bySgg = new Map<string, number>();
      for (const r of dayRows) if (r.sigungu) bySgg.set(r.sigungu, (bySgg.get(r.sigungu) ?? 0) + 1);
      const top = [...bySgg.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
      setBrief({ day, n: dayRows.length, top: top?.[0] ?? null, topN: top?.[1] ?? 0, isYesterday: day === yesterday });
    }).catch(() => {});
  }, []);
  const [open, setOpen] = useState<OpenRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [forecastLoaded, setForecastLoaded] = useState(false);
  const [badges, setBadges] = useState<Record<string, { part: number; wins: number }>>({});

  const [openLoaded, setOpenLoaded] = useState(false);
  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then(setOpen).finally(() => setOpenLoaded(true));
  }, []);

  /** 보는 지역으로 거른 목록 — 제목·히어로·목록이 모두 이 배열을 센다 (U26) */
  const visible = useMemo(
    () => (viewRegions?.length ? open.filter(o => o.sigungu && viewRegions.includes(o.sigungu)) : open),
    [open, viewRegions]);

  /** 첫 화면은 마감 임박 8건까지만 — 나머지는 1클릭 뒤 (U28) */
  const HEAD = 8;
  const byDeadline = useMemo(() => [...visible].sort((a, b) =>
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')), [visible]);
  const [showRest, setShowRest] = useState(false);
  const [showAll, setShowAll] = useState(false); // 전국(지역 필터 밖)까지
  useEffect(() => { setShowRest(false); setShowAll(false); }, [viewRegions?.join(',')]);
  const head = byDeadline.slice(0, HEAD);

  // 빈 화면 계측 — 내 자격 지역 공고가 0건인 날 (하루 1회)
  useEffect(() => {
    if (!openLoaded || visible.length > 0) return;
    trackOnce('open_empty', { from: 'today', regions: homes.length }, todayKey());
  }, [openLoaded, visible.length, homes.length]);

  /** 판단 근거 한 줄용 회차 — 값을 넣은 카드만 1회 로드 (U37, 컨트롤·요청 예산 유지) */
  const [hist, setHist] = useState<Record<string, { floorRate: number | null; winRate: number | null; effFloor?: number | null; maxInvalid?: number | null }[]>>({});
  const histReq = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const o of head) {
      const sid = o.schoolId;
      if (!sid || !hasAnyRate(marks[o.bidNo], bizNos) || histReq.current.has(sid)) continue;
      histReq.current.add(sid);
      // ② 리허설과 같은 소스(effFloor 포함) — 두 화면 숫자가 갈리면 안 된다
      fetch(`/api/rounds/school/${encodeURIComponent(sid)}`).then(r => r.json())
        .then(d => { if (Array.isArray(d)) setHist(h => ({ ...h, [sid]: d })); })
        .catch(() => {});
    }
  }, [head, marks]);
  const rest = byDeadline.slice(HEAD);
  const nationRest = useMemo(() => {
    if (!viewRegions?.length) return [];
    const seen = new Set(visible.map(o => o.bidNo));
    return open.filter(o => !seen.has(o.bidNo))
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  }, [open, visible, viewRegions]);
  // 발주 예보 — 세션 준비 전 호출 금지 + 이전 요청 취소 + 스테일 응답 폐기 (U18)
  useEffect(() => {
    if (!sessionReady) return;
    const key = homes.join(',');
    const ac = new AbortController();
    fetch(`/api/schools/forecast${key ? `?sigungu=${key}` : ''}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (key === homes.join(',')) setForecast(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => setForecastLoaded(true));
    return () => ac.abort();
  }, [homes.join(','), sessionReady]);

  // 어제 채점 — 투찰함 표시분
  useEffect(() => {
    const done = Object.entries(marks).filter(([, m]) => m.s === 'done').map(([id]) => id);
    if (!done.length) return;
    fetch(`/api/results?bidNos=${done.join(',')}&bizNos=${bizNos.join(',')}`)
      .then(r => r.json())
      .then((rs: ResultRow[]) => setResults(rs.filter(r => r.status !== '대기')));
  }, [marks, bizNos]);

  // 내 전적 뱃지 배치
  useEffect(() => {
    const names = open.map(o => o.schoolName).filter(Boolean) as string[];
    if (!bizNos.length || !names.length) return;
    fetch(`/api/firms/badges?bizNos=${bizNos.join(',')}&schools=${names.map(encodeURIComponent).join(',')}`)
      .then(r => r.json()).then(setBadges);
  }, [open, bizNos]);

  const graded = useMemo(() => results.map(r => {
    const myRate = marks[r.bidNo]?.rate ?? null;
    const diff = myRate != null && r.winRate != null ? +(myRate - r.winRate).toFixed(3) : null;
    return { ...r, myRate, diff };
  }), [results, marks]);

  return (
    <div className='flex flex-1 flex-col space-y-6 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>오늘</h1>
        <p className='text-muted-foreground text-sm tabular-nums'>
          {brief
            ? <>{brief.isYesterday ? '어제' : `최근 개찰일 ${brief.day.slice(5)}`} 전국 {brief.n.toLocaleString()}건 개찰</>
            : '전국 137개 시군구 · 공고 10만 건 · 투찰 694만 데이터 기준.'}
        </p>
        <div className='mt-1'><RegionStatus /></div>
      </div>

      {/* 히어로 — 할 일 자체 (A: 건수 대신 가장 급한 공고) */}
      {!openLoaded && <Skeleton className='h-[116px] w-full rounded-xl' />}
      {openLoaded && visible.length > 0 && (() => {
        const sorted = [...visible].filter(o => o.deadline)
          .sort((a, b) => +new Date(a.deadline!) - +new Date(b.deadline!));
        const next = sorted[0] ?? visible[0];
        const unfilled = visible.filter(o => marks[o.bidNo] && !hasAnyRate(marks[o.bidNo], bizNos)).length;
        return (
          <Card className='border-primary'>
            <CardContent className='flex flex-wrap items-end justify-between gap-3 py-4' style={{ minHeight: 84 }}>
              <div>
                <div className='text-muted-foreground text-xs'>가장 급한 공고</div>
                <div className='text-xl font-bold'>
                  {next.schoolName ?? '학교 미상'} {next.category ?? ''}
                  <span className='text-destructive ml-2 text-base'>{dday(next.deadline) ?? ''}</span>
                </div>
              </div>
              <div className='text-right text-sm tabular-nums'>
                {visible.length > 1 && <div>다음 마감까지 {visible.length}건 진행 중</div>}
                {unfilled > 0 && <div className='text-amber-600'>값 미입력 {unfilled}건</div>}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div>
        <h2 className='mb-2 font-semibold'>
          마감 임박 {Math.min(HEAD, visible.length)}건
          {visible.length > HEAD && <span className='text-muted-foreground ml-1 text-sm font-normal tabular-nums'>· 내 지역 {visible.length}건 중</span>}
        </h2>
        {openLoaded && visible.length === 0 && (
          <Card><CardContent className='py-6'>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>진행 중인 공고가 없습니다</EmptyTitle>
                <EmptyDescription>신규 공고는 대체로 매달 하순에 등록됩니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent></Card>
        )}
        <div className='grid gap-3 lg:grid-cols-2'>
          {!openLoaded && Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={`sk${i}`} className='h-[213px] w-full rounded-xl' />
          ))}
          {openLoaded && head.map((o, cardIdx) => {
            const m = marks[o.bidNo];
            const myRates = ratesOf(m, bizNos);
            const b = badges[o.schoolName ?? ''];
            return (
              <Link key={o.bidNo} href={`/dashboard/auction/${o.bidNo}`} className='block'>
                <Card className={`h-full transition-colors hover:border-primary ${m?.s === 'done' ? 'border-primary/60' : m?.s === 'watch' ? 'border-primary' : ''}`}>
                  <CardHeader className='pb-2'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <CardTitle className='text-base'>{o.schoolName ?? '학교 미상'}</CardTitle>
                      <div className='flex gap-1.5'>
                        {o.category && <Badge variant='secondary'>{o.category}</Badge>}
                        {o.sigungu && !o.sigungu.includes('김해') && <Badge variant='outline'>{o.sigungu} · 자격 충족</Badge>}
                        <Badge variant='destructive'>{dday(o.deadline) ?? '마감 미상'}</Badge>
                      </div>
                    </div>
                    <CardDescription className='tabular-nums'>
                      기초 {won(o.basePrice)}원 · 하한 {o.floorRate}
                      {b && <> · <b className='text-foreground'>투찰 {b.part}회 · 낙찰 {b.wins}회</b></>}
                      {m?.s === 'done' && (() => {
                        const parts = slots.filter(k => myRates[k] != null)
                          .map(k => `${slots.length > 1 && bizLabel(k) ? `${bizLabel(k)} ` : ''}${myRates[k]}`);
                        return <> · ✓ 저장됨{parts.length ? ` (${parts.join(' · ')})` : ''}</>;
                      })()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='space-y-2'>
                    <div className='flex flex-wrap items-end justify-between gap-2 text-sm tabular-nums'>
                      <div className='text-muted-foreground text-xs'>
                        하한 금액 {won(o.anchorAmount)}원 (기초 × 하한율)
                      </div>
                      <div className='text-right'>
                        {o.recent3.length > 0 && <div>최근 낙찰 <b>{o.recent3.map(v => v.toFixed(2)).join(' · ')}</b></div>}
                        {o.band?.dense && <div className='text-muted-foreground'>잘 나온 구간 {o.band.dense.lo.toFixed(2)}~{o.band.dense.hi.toFixed(2)}</div>}
                        {o.usualN != null && <div className='text-muted-foreground'>보통 {o.usualN}곳 참여</div>}
                      </div>
                    </div>

                    {/* 값 입력·저장 — 카드 안에서 완결 (A: 바구니 병합) */}
                    <div className='flex flex-wrap items-center gap-2 border-t pt-2'
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                      {slots.map((bz, si) => (
                        <span key={bz || '_'} className='flex items-center gap-1'>
                          {slots.length > 1 && (
                            <span className='text-muted-foreground max-w-16 truncate text-xs' title={bz}>
                              {bizLabel(bz)}
                            </span>
                          )}
                          <RateInput value={myRates[bz]}
                            slotId={`${cardIdx}:${si}`}
                            ariaLabel={slots.length > 1 ? `${bizLabel(bz)} 투찰률` : '투찰률'}
                            title={bz || undefined}
                            placeholder={`투찰률 ${((o.floorRate ?? 90) + 0.05).toFixed(2)}`}
                            onEnter={() => focusSlot(`${cardIdx + 1}:0`)}
                            onChange={v => {
                              if (!m) trackAction('basket_add', { bidNo: o.bidNo, from: 'today' });
                              set(o.bidNo, withRate(m, bz, v, bizNos));
                            }}
                            className='h-8 w-32 font-mono' />
                        </span>
                      ))}
                      {(() => {
                        // 입력 전: 추천값(최근 낙찰 중앙값 또는 하한+0.05)을 흐린 큰 글씨로 미리 보여준다 (U30)
                        if (!o.basePrice) return null;
                        const suggest = o.recent3.length
                          ? [...o.recent3].sort((a, b) => a - b)[Math.floor(o.recent3.length / 2)]
                          : (o.floorRate ?? 90) + 0.05;
                        const filledSlots = slots.filter(k => myRates[k] != null);
                        if (slots.length === 1) {
                          const shown = myRates[slots[0]] ?? suggest;
                          const filled = myRates[slots[0]] != null;
                          return (
                            <span className='tabular-nums'>
                              <span className='text-muted-foreground text-xs'>내가 넣을 금액 </span>
                              <b className={`text-xl ${filled ? 'text-primary' : 'text-muted-foreground/45'}`}>
                                {won(o.basePrice * shown / 100)}원
                              </b>
                              {!filled && <span className='text-muted-foreground/60 ml-1 text-xs'>({shown.toFixed(2)} 기준 미리보기)</span>}
                            </span>
                          );
                        }
                        return (
                          <span className='tabular-nums'>
                            <span className='text-muted-foreground text-xs'>내가 넣을 금액 </span>
                            {filledSlots.length === 0 ? (
                              <>
                                <b className='text-muted-foreground/45 text-xl'>{won(o.basePrice * suggest / 100)}원</b>
                                <span className='text-muted-foreground/60 ml-1 text-xs'>({suggest.toFixed(2)} 기준 미리보기)</span>
                              </>
                            ) : filledSlots.map((k, i) => (
                              <span key={k || '_'}>
                                {i > 0 && <span className='text-muted-foreground mx-1'>·</span>}
                                <b className='text-primary text-lg'>{won(o.basePrice! * myRates[k] / 100)}원</b>
                                <span className='text-muted-foreground ml-0.5 text-xs'>{bizLabel(k)}</span>
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                      {(() => {
                        const saved = m?.s === 'done';
                        const changed = saved && !sameRates(myRates, savedRates[o.bidNo] ?? myRates);
                        const filled = slots.filter(k => myRates[k] != null);
                        const anyBelow = filled.some(k => o.floorRate != null && myRates[k] < o.floorRate);
                        const label = filled.map(k => myRates[k]).join(' · ');
                        return (
                          <Button size='sm' className='h-8' variant={saved && !changed ? 'secondary' : 'default'}
                            disabled={filled.length === 0 || anyBelow}
                            onClick={() => {
                              trackAction(!saved ? 'mark_done' : 'mark_update',
                                { bidNo: o.bidNo, rate: primaryRate(m, bizNos), from: 'today' });
                              set(o.bidNo, { ...(m ?? { s: 'watch' }), s: 'done', rates: myRates, rate: primaryRate(m, bizNos) });
                              setSavedRates(v => ({ ...v, [o.bidNo]: myRates }));
                            }}>
                            {!saved ? '투찰 저장' : changed ? '이 값으로 갱신' : `✓ 저장됨 (${label})`}
                          </Button>
                        );
                      })()}
                      {m?.s === 'done' && (
                        <button className='text-muted-foreground text-xs hover:underline'
                          onClick={() => {
                            trackAction('mark_undone', { bidNo: o.bidNo, rate: primaryRate(m, bizNos), from: 'today' });
                            set(o.bidNo, { ...(m ?? { s: 'watch' }), s: 'watch' });
                          }}>해제</button>
                      )}
                      {/* 판단 근거 — 사실 + 표본 n 만 (U37). 2칸이면 칸마다 한 줄 (U9) */}
                      {hasAnyRate(m, bizNos) && (
                        <div className='w-full space-y-0.5 text-xs tabular-nums'>
                          {slots.filter(k => myRates[k] != null).map(bz => {
                            const rate = myRates[bz];
                            const tag = slots.length > 1 && bizLabel(bz)
                              ? <span className='text-foreground mr-1 font-medium'>{bizLabel(bz)}</span> : null;
                            if (o.floorRate != null && rate < o.floorRate) {
                              return (
                                <div key={bz || '_'}>
                                  {tag}<span className='text-destructive font-medium'>하한 {o.floorRate} 아래라 무효</span>
                                </div>
                              );
                            }
                            const rounds = (o.schoolId && hist[o.schoolId]) || [];
                            const same = rounds.filter(x => x.floorRate === o.floorRate && x.winRate != null);
                            if (same.length < 3) return (
                              <div key={bz || '_'}>{tag}<span className='text-muted-foreground'>같은 하한 기록 {same.length}회 — 표본이 적습니다</span></div>
                            );
                            let push = 0, win = 0, alive = 0, dead = 0;
                            for (const x of same) {
                              if (rate >= x.winRate!) push++;
                              else if (x.effFloor != null) (rate < x.effFloor ? dead++ : win++);
                              else if (x.maxInvalid != null && rate <= x.maxInvalid) dead++;
                              else alive++;
                            }
                            return (
                              <div key={bz || '_'}>
                                {tag}
                                <span className='text-muted-foreground'>
                                  이 값이면 과거 {same.length}회 중{' '}
                                  <b className='text-primary'>{win}회</b> 먹었을 값
                                  {alive > 0 && <> · 예정가 추첨이 갈랐을 게 <b style={{ color: '#2962ff' }}>{alive}회</b></>}
                                  {push > 0 && <> · 남이 더 낮게 써서 밀린 게 <b className='text-amber-600'>{push}회</b></>}
                                  {dead > 0 && <> · 하한 아래라 무효였을 게 <b className='text-destructive'>{dead}회</b></>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <span className='ml-auto flex gap-2 text-xs'>
                        {o.schoolId && (
                          <button className='text-primary hover:underline'
                            onClick={() => { window.location.href = `/dashboard/analysis/${encodeURIComponent(o.schoolId ?? '')}?bidNo=${encodeURIComponent(o.bidNo)}${m?.rate != null ? `&rate=${m.rate}&base=${o.basePrice ?? ''}` : ''}`; }}>
                            분석판
                          </button>
                        )}
                        <button className='text-muted-foreground hover:underline'
                          onClick={() => window.open('https://ns.eat.co.kr', '_blank')}>NeaT ↗</button>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* 나머지는 1클릭 뒤 — 컴팩트 행(입력칸 없음). 높이는 항상 확보 (U33) */}
        <div className='mt-3 min-h-8'>
        {(rest.length > 0 || nationRest.length > 0) && (
          <div className='flex flex-wrap gap-2'>
            {rest.length > 0 && (
              <Button size='sm' variant='outline' onClick={() => setShowRest(v => !v)}>
                {showRest ? '접기' : `내 지역 나머지 ${rest.length}건 더 보기`}
              </Button>
            )}
            {nationRest.length > 0 && (
              <Button size='sm' variant='outline' onClick={() => setShowAll(v => !v)}>
                {showAll ? '전국 접기' : `전국 ${nationRest.length}건 더 보기`}
              </Button>
            )}
          </div>
        )}
        </div>
        {(showRest || showAll) && (
          <Card className='mt-2'><CardContent className='divide-y p-0'>
            {[...(showRest ? rest : []), ...(showAll ? nationRest : [])].map(o => (
              <Link key={o.bidNo} href={`/dashboard/auction/${o.bidNo}`}
                className='hover:bg-accent flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm tabular-nums'>
                <span className='truncate'>
                  <b>{o.schoolName ?? '학교 미상'}</b>
                  <span className='text-muted-foreground ml-1 text-xs'>{o.sigungu} · {o.category}</span>
                </span>
                <span className='text-muted-foreground shrink-0'>
                  하한 {o.floorRate} · {won(o.anchorAmount)}원
                  <span className='text-destructive ml-2'>{dday(o.deadline) ?? ''}</span>
                </span>
              </Link>
            ))}
          </CardContent></Card>
        )}
      </div>

      <div>
        <h2 className='mb-2 font-semibold'>발주 예정</h2>
        {!forecastLoaded && <Skeleton className='h-[168px] w-full rounded-xl' />}
        {forecastLoaded && homes.length === 0 && (
          <Card><CardContent className='text-muted-foreground py-4 text-sm'>
            자격 지역을 설정하면 내 지역 발주 예정이 보입니다.{' '}
            <Link href='/welcome' className='text-primary font-semibold hover:underline'>설정 →</Link>
          </CardContent></Card>
        )}
        {forecastLoaded && homes.length > 0 && <Card><CardContent className='divide-y p-0'>
          {forecast.length === 0 && (
            <div className='px-4 py-4'>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>2주 내 발주 예정이 없습니다</EmptyTitle>
                  <EmptyDescription>발주 주기가 쌓이면 예상 날짜가 표시됩니다.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
          {forecast.slice(0, 5).map(f => (
            <div key={f.schoolId} className='px-4 py-3 text-[15px]'>
              <Link href={`/dashboard/schools/${encodeURIComponent(f.schoolId)}`}
                className='font-semibold hover:underline'>{f.schoolName}</Link>
              {' · '}발주 주기 {f.medGapDays}일 · 지난 발주 {f.lastOpened.slice(5)} · 예상{' '}
              <b>{f.dueInDays <= 0 ? '도래' : `${f.expected.slice(5)} (D-${f.dueInDays})`}</b>
              {f.lastWinRate != null && <span className='text-muted-foreground tabular-nums'> · 지난 회 낙찰 {f.lastWinRate.toFixed(2)}</span>}
            </div>
          ))}
        </CardContent></Card>}
      </div>
    </div>
  );
}
