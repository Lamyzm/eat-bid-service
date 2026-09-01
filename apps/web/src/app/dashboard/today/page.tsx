/** @module 책임: 기존 오늘의 공고 탐색 상태와 분석 이동 흐름을 제공하는 교체 예정 화면이다. */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { buildAnalysisRoute } from '@/routing/analysis';
import { useWorkspace } from '@/lib/workspace';
import { useRegion } from '@/lib/region';
import { useSession } from '@/lib/session';
import { RegionStatus } from '@/components/region-status';
import { RateInput } from '@/components/rate-input';
import { LoadError } from '@/components/load-error';
import { pickBand, bandBasisText } from '@/lib/band';
import { deadlineText, isClosed, isNotStarted } from '@/lib/deadline';
import { DataScope } from '@/components/data-scope';
import { fetchJson, quietFailure } from '@/lib/fetch-json';
import { slotKeysFor, ratesOf, withRate, primaryRate, hasAnyRate, sameRates, bizLabelOf } from '@/lib/mark-rates';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarks } from '@/lib/marks';
import { useTrack, trackAction, trackOnce, todayKey } from '@/lib/track';
import { usePersistedFlag } from '@/lib/use-persisted-state';
import { won } from '@/lib/format';
import { kstDate, kstTime, todayKST, daysAgoKST } from '@eatbid/shared';
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
  /**
   * 투찰 마감 — 카운트다운·정렬은 이 값을 쓴다.
   * `deadline`(개찰 시각)은 마감보다 늦다. 차이는 94.8%가 60분이지만 나머지는 다르고
   * 최대 18시간까지 벌어져, 고정 오프셋으로 보정하면 안 된다. 실제 값만 쓴다.
   */
  bidEndAt?: string | null;
  /** 투찰 시작 — "아직 시작 전" 구분용 */
  bidBeginAt?: string | null;
  band: { n?: number; dense?: { lo: number; hi: number; pct: number } } | null;
  recent3: number[]; usualN: number | null;
  /** 서버가 실어 보내는 자격 정보 — 없으면 뱃지를 띄우지 않는다 */
  allowedLabel?: string | null; unrestricted?: boolean;
  qualificationBasis?: 'region-only' | string | null;
  /** 품목 — categories 가 이 공고의 전부, category 는 대표 하나 */
  categories?: string[]; isMultiCategory?: boolean;
  categorySrc?: 'main_item' | 'name_rule' | 'none' | string | null;
  /** 이 목록을 받아온 시각 (서버 적재 시각) */
  fetchedAt?: string | null;
  /** 품목별 band/recent3/nSameFloor — 전 품목 합산 대신 이걸 쓴다 */
  byCat?: Record<string, { band?: any; recent3?: number[]; nSameFloor?: number }> | null;
  /** 이 학교의 품목별 회차 수 — 표본이 몇 회인지 화면이 말한다 */
  catCounts?: Record<string, number> | null;
  /** 같은 하한 회차 수 */
  nSameFloor?: number | null;
};
type ForecastRow = { schoolId: string; schoolName: string; lastOpened: string; medGapDays: number; expected: string; dueInDays: number; lastWinRate: number | null };

/**
 * 이 공고에 붙일 과거 기록이 있는가.
 * 서버는 없으면 nSameFloor: 0 · band: null 로 정확히 알려주는데, 화면이 조건부 렌더링이라
 * 아무것도 안 보여서 "자료 없음"과 "로딩 중"을 구별할 수 없었다. 열린 공고의 35%가 이 상태다.
 */
function hasHistory(o: OpenRow): boolean {
  return (o.nSameFloor ?? 0) > 0 || o.recent3.length > 0 || o.band != null || o.usualN != null;
}

export default function TodayPage() {
  const { bizNos, ready } = useWorkspace();
  const { homes, viewRegions, view, isBrowsing } = useRegion();
  const { ready: sessionReady, marksUnreadable, bizNames } = useSession();
  const { marks, set } = useMarks();
  // 저장 시점 값 — '이 값으로 갱신' 판별용
  const [savedRates, setSavedRates] = useState<Record<string, Record<string, number>>>({});
  // 이전 저장분을 읽지 못한 경우의 고지 (닫으면 다시 뜨지 않는다)
  // 초기 true = 저장소를 읽기 전에는 띄우지 않는다(깜빡임 방지), 저장된 값이 없으면 false 로 내린다
  const [noticeOff, setNoticeOff] = usePersistedFlag('eatbid.marksNoticeSeen', true, { whenMissing: false });

  const bizLabel = (bz: string) => bizLabelOf(bz, bizNames, true);
  // 다중 품목 펼침 — 대표 품목만 보여주면 나머지가 화면에서 사라진다
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const toggleCats = (bidNo: string) => setOpenCats(prev => {
    const next = new Set(prev);
    if (next.has(bidNo)) next.delete(bidNo); else next.add(bidNo);
    return next;
  });
  // 입력칸 등록부 — DOM 을 뒤지지 않고 다음 칸으로 이동한다
  const slotRefs = useRef(new Map<string, HTMLInputElement>());
  const registerSlot = (id: string) => (el: HTMLInputElement | null) => {
    if (el) slotRefs.current.set(id, el);
    else slotRefs.current.delete(id);
  };
  const focusSlot = (id: string) => {
    const el = slotRefs.current.get(id);
    if (el) { el.focus(); el.select(); }
  };
  useTrack('today');
  const router = useRouter();
  // 데일리 브리핑 — 어제 전국 개찰 (사실 카운트만)
  const [brief, setBrief] = useState<{ day: string; n: number; top: string | null; topN: number; isYesterday: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/wins/recent?days=2&limit=1000').then(r => r.json()).then(d => {
      const rows: any[] = Array.isArray(d) ? d : (d.rows ?? []);
      if (rows.length === 0) { setBrief(null); return; }
      const yesterday = daysAgoKST(1);
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
    }).catch(quietFailure('어제 개찰 요약'));
  }, []);
  const [open, setOpen] = useState<OpenRow[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [forecastLoaded, setForecastLoaded] = useState(false);
  const [forecastFailed, setForecastFailed] = useState(false);
  const [badges, setBadges] = useState<Record<string, { part: number; wins: number }>>({});

  const [openLoaded, setOpenLoaded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);
  const [openReload, setOpenReload] = useState(0);
  useEffect(() => {
    setOpenError(false);
    fetchJson<OpenRow[]>('/api/open').then(rows => {
      setOpen(rows);
      // 적재 시각 — 로더가 멈추면 이 값이 안 움직인다. 사장이 유일한 관측자다 (X19)
      setFetchedAt(Array.isArray(rows) && rows[0]?.fetchedAt ? rows[0].fetchedAt : null);
    }).catch(() => setOpenError(true)).finally(() => setOpenLoaded(true));
  }, [openReload]);

  /**
   * 내가 낼 수 있는 목록 — 허용지역(누가 낼 수 있나)과 학교 소재지(어디 학교인가)는 다른 개념이다.
   * 소재지로만 걸러서 의정부·강남 사장이 낼 수 있는 무제한 공고 65건을 0건으로 보고 있었다.
   * 다른 지역을 둘러보는 중이면 그 지역 판을 그대로 보여준다.
   */
  const visible = useMemo(() => {
    if (!viewRegions?.length) return open;
    if (isBrowsing) return open.filter(o => o.sigungu && viewRegions.includes(o.sigungu));
    return open.filter(o => o.unrestricted || (o.sigungu && viewRegions.includes(o.sigungu)));
  }, [open, viewRegions, isBrowsing]);

  /** 첫 화면은 마감 임박 8건까지만 — 나머지는 1클릭 뒤 (U28) */
  const HEAD = 8;
  // 마감이 지난 공고가 '마감 임박' 앞자리를 차지하지 않게 뒤로 보낸다.
  // 마감 기준이 개찰 시각에서 실제 마감(1시간 이르다)으로 바뀌면 지난 공고가 실제로 생긴다.
  const byDeadline = useMemo(() => [...visible].sort((a, b) => {
    const ca = isClosed(a.bidEndAt) ? 1 : 0;
    const cb = isClosed(b.bidEndAt) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return (a.bidEndAt ?? '9999').localeCompare(b.bidEndAt ?? '9999');
  }), [visible]);
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
  const [histError, setHistError] = useState<Record<string, boolean>>({});
  useEffect(() => {
    for (const o of head) {
      const sid = o.schoolId;
      if (!sid || !hasAnyRate(marks[o.bidNo], bizNos) || histReq.current.has(sid)) continue;
      histReq.current.add(sid);
      // ② 리허설과 같은 소스(effFloor 포함) — 두 화면 숫자가 갈리면 안 된다
      fetchJson<any[]>(`/api/rounds/school/${encodeURIComponent(sid)}`)
        .then(d => { if (Array.isArray(d)) setHist(h => ({ ...h, [sid]: d })); })
        .catch(() => setHistError(e => ({ ...e, [sid]: true })));
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
      .catch(() => setForecastFailed(true))
      .finally(() => setForecastLoaded(true));
    return () => ac.abort();
  }, [homes.join(','), sessionReady]);

  // 어제 채점 — 투찰함 표시분

  // 내 전적 뱃지 배치
  useEffect(() => {
    const names = open.map(o => o.schoolName).filter(Boolean) as string[];
    if (!bizNos.length || !names.length) return;
    fetch(`/api/firms/badges?bizNos=${bizNos.join(',')}&schools=${names.map(encodeURIComponent).join(',')}`)
      .then(r => r.json()).then(setBadges);
  }, [open, bizNos]);


  return (
    <div className='flex flex-1 flex-col space-y-6 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>오늘</h1>
        <p className='text-muted-foreground text-sm tabular-nums'>
          {brief
            ? <>{brief.isYesterday ? '어제' : `최근 개찰일 ${brief.day.slice(5)}`} 전국 {brief.n.toLocaleString()}건 개찰</>
            : <DataScope />}
        </p>
        <div className='mt-1'><RegionStatus /></div>
        {fetchedAt && (() => {
          const day = kstDate(new Date(fetchedAt));
          const fresh = day === todayKST();
          return (
            <p className={`mt-0.5 text-xs tabular-nums ${fresh ? 'text-muted-foreground' : 'text-destructive font-medium'}`}>
              {fresh
                ? `${kstTime(new Date(fetchedAt))} 기준 목록입니다.`
                : `${day} ${kstTime(new Date(fetchedAt))} 기준 목록입니다. 오늘 자료가 아직 들어오지 않았습니다.`}
            </p>
          );
        })()}
      </div>

      {marksUnreadable && !noticeOff && (
        <Card className='border-amber-500/60'>
          <CardContent className='flex flex-wrap items-center justify-between gap-2 py-3 text-sm'>
            <span>
              <b>이전에 저장한 값을 읽지 못했습니다.</b>{' '}
              새로 저장하는 값은 정상 기록됩니다.{' '}
              <span className='text-muted-foreground'>
                읽지 못한 값은 이 브라우저에 사본으로 남아 있습니다.
              </span>
            </span>
            <Button size='sm' variant='outline' onClick={() => setNoticeOff(true)}>확인</Button>
          </CardContent>
        </Card>
      )}

      {/* 히어로 — 할 일 자체 (A: 건수 대신 가장 급한 공고) */}
      {!openLoaded && <Skeleton className='h-[116px] w-full rounded-xl' />}
      {openLoaded && visible.length > 0 && (() => {
        const sorted = [...visible].filter(o => o.bidEndAt && !isClosed(o.bidEndAt) && !isNotStarted(o.bidBeginAt))
          .sort((a, b) => +new Date(a.bidEndAt!) - +new Date(b.bidEndAt!));
        const next = sorted[0] ?? visible[0];
        const unfilled = visible.filter(o => marks[o.bidNo] && !hasAnyRate(marks[o.bidNo], bizNos)).length;
        return (
          <Card className='border-primary'>
            <CardContent className='flex flex-wrap items-end justify-between gap-3 py-4' style={{ minHeight: 84 }}>
              <div>
                <div className='text-muted-foreground text-xs'>가장 급한 공고</div>
                <div className='text-xl font-bold'>
                  {next.schoolName ?? '학교 미상'} {next.category ?? ''}
                  <span className='text-destructive ml-2 text-base'>{deadlineText(next.bidEndAt) ?? ''}</span>
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
        {openLoaded && openError && (
          <Card><CardContent className='p-0'>
            <LoadError what='공고 목록' onRetry={() => setOpenReload(n => n + 1)} />
          </CardContent></Card>
        )}
        {openLoaded && !openError && visible.length === 0 && (
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
            // 등록 사업자 + 값이 있는 미지정 슬롯까지 (서버 biz_no='' 행이 사라지지 않도록)
            const slots = slotKeysFor(m, bizNos);
            const b = badges[o.schoolName ?? ''];
            return (
              <Link key={o.bidNo} href={`/dashboard/auction/${o.bidNo}`} className='block'>
                <Card className={`h-full transition-colors hover:border-primary ${m?.s === 'done' ? 'border-primary/60' : m?.s === 'watch' ? 'border-primary' : ''}`}>
                  <CardHeader className='pb-2'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <CardTitle className='text-base'>{o.schoolName ?? '학교 미상'}</CardTitle>
                      <div className='flex gap-1.5'>
                        {(() => {
                          const cats = o.categories?.length ? o.categories : (o.category ? [o.category] : []);
                          if (o.categorySrc === 'none') return <Badge variant='outline'>품목 미표기</Badge>;
                          if (cats.length === 0) return null;
                          if (cats.length > 1) {
                            const shown = openCats.has(o.bidNo);
                            return (
                              <button type='button' title={cats.join(' · ')}
                                onClick={e => { e.preventDefault(); e.stopPropagation(); toggleCats(o.bidNo); }}>
                                <Badge variant='secondary'>
                                  {shown ? cats.join(' · ') : `종합 ${cats.length}품목`}
                                </Badge>
                              </button>
                            );
                          }
                          return <Badge variant='secondary'>{cats[0]}</Badge>;
                        })()}
                        {o.categorySrc === 'name_rule' && (
                          <span className='text-muted-foreground self-center text-xs'>공고명에서 추정</span>
                        )}
                        {(() => {
                          // 자격은 서버가 준 값으로만 말한다. 제한 공고는 단언하지 않는다 —
                          // 원본 허용지역이 절단형(`정읍`)이라 우리가 대조할 수 없다.
                          if (o.unrestricted) {
                            return <Badge variant='outline'>{o.sigungu} · 지역 제한 없음</Badge>;
                          }
                          if (o.allowedLabel) {
                            return <Badge variant='outline'>{o.sigungu} · {o.allowedLabel} 제한</Badge>;
                          }
                          return o.sigungu ? <Badge variant='outline'>{o.sigungu}</Badge> : null;
                        })()}
                        {deadlineText(o.bidEndAt) && <Badge variant='destructive'>{deadlineText(o.bidEndAt)}</Badge>}
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
                        {/* 재료가 없으면 침묵하지 않는다 — 없다는 것도 재료다 */}
                        {!hasHistory(o) && (
                          <div className='text-muted-foreground'>이 학교는 지난 개찰 기록이 아직 없습니다</div>
                        )}
                        {(() => {
                          // 품목별 값이 있으면 그걸 쓴다. 어느 근거로 고른 구간인지도 밝힌다.
                          const picked = pickBand(o);
                          return (
                            <>
                              {picked.recent3.length > 0 && (
                                <div>최근 낙찰 <b>{picked.recent3.map(v => v.toFixed(2)).join(' · ')}</b></div>
                              )}
                              {picked.band?.dense && (
                                <div className='text-muted-foreground'>
                                  잘 나온 구간 {picked.band.dense.lo.toFixed(2)}~{picked.band.dense.hi.toFixed(2)}
                                  {' · '}{bandBasisText(picked)}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {o.usualN != null && <div className='text-muted-foreground'>보통 {o.usualN}곳 참여</div>}
                        {isNotStarted(o.bidBeginAt) && (
                        <div className='text-muted-foreground'>
                          {kstDate(new Date(o.bidBeginAt!)).slice(5)} {kstTime(new Date(o.bidBeginAt!))}부터 투찰합니다.
                        </div>
                      )}
                      {isClosed(o.bidEndAt) && (
                        <div className='text-muted-foreground'>
                          투찰 시간이 지났습니다.
                          {o.deadline && <> 개찰 {kstDate(new Date(o.deadline)).slice(5)} {kstTime(new Date(o.deadline))}.</>}
                        </div>
                      )}
                      {!o.unrestricted && o.allowedLabel && (
                        <div className='text-muted-foreground'>참가 자격은 사무소 소재지 기준입니다. 자격 여부는 확인이 필요합니다.</div>
                      )}
                      {/* 표본 수 — 분류가 정확해지며 표본이 줄어든 자리를 화면이 숨기지 않는다 */}
                        {o.catCounts && (() => {
                          const cats = o.categories?.length ? o.categories : (o.category ? [o.category] : []);
                          const parts = cats.filter(c => o.catCounts![c] != null).map(c => `${c} ${o.catCounts![c]}회`);
                          return parts.length ? <div className='text-muted-foreground'>이 학교 {parts.join(' · ')}</div> : null;
                        })()}
                      </div>
                    </div>

                    {/* 값 입력·저장 — 카드 안에서 완결 (A: 바구니 병합) */}
                    <div className='flex flex-wrap items-center gap-2 border-t pt-2'
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                      {slots.map((bz, si) => (
                        <span key={bz || '_'} className='flex flex-col gap-0.5'>
                          {/* 두 칸 중 어느 사업자인지가 이 카드의 핵심이라 라벨을 자르지 않는다 */}
                          {slots.length > 1 && (
                            <span className='text-muted-foreground w-32 truncate text-xs' title={bz}>
                              {bizLabel(bz)}
                            </span>
                          )}
                          <RateInput value={myRates[bz]}
                            slotId={`${cardIdx}:${si}`}
                            inputRef={registerSlot(`${cardIdx}:${si}`)}
                            ariaLabel={slots.length > 1 ? `${bizLabel(bz)} 투찰률` : '투찰률'}
                            title={bz || undefined}
                            placeholder={o.floorRate != null ? `투찰률 ${(o.floorRate + 0.05).toFixed(2)}` : '투찰률'}
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
                          : o.floorRate != null ? o.floorRate + 0.05 : null;
                        const filledSlots = slots.filter(k => myRates[k] != null);
                        if (slots.length === 1) {
                          const shown = myRates[slots[0]] ?? suggest;
                          const filled = myRates[slots[0]] != null;
                          // 추천할 근거가 없으면 미리보기를 만들지 않는다 (하한을 지어내지 않는다)
                          if (shown == null) return null;
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
                              suggest == null ? null : (
                                <>
                                  <b className='text-muted-foreground/45 text-xl'>{won(o.basePrice * suggest / 100)}원</b>
                                  <span className='text-muted-foreground/60 ml-1 text-xs'>({suggest.toFixed(2)} 기준 미리보기)</span>
                                </>
                              )
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
                              set(o.bidNo, { ...(m ?? { s: 'watch' }), s: 'done', rates: myRates });
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
                                  {tag}<span className='text-destructive font-medium'>하한 {o.floorRate} 아래입니다</span>
                                </div>
                              );
                            }
                            const loaded = !!(o.schoolId && hist[o.schoolId]);
                            if (!hasHistory(o)) return (
                              <div key={bz || '_'}>{tag}<span className='text-muted-foreground'>이 학교는 지난 개찰 기록이 아직 없습니다</span></div>
                            );
                            if (o.schoolId && histError[o.schoolId]) return (
                              <div key={bz || '_'}>{tag}<LoadError what='과거 기록' inline /></div>
                            );
                            if (!loaded) return (
                              <div key={bz || '_'}>{tag}<span className='text-muted-foreground'>과거 기록을 불러오는 중입니다</span></div>
                            );
                            const rounds = hist[o.schoolId!];
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
                                  {dead > 0 && <> · 내 값이 하한 아래였던 게 <b className='text-destructive'>{dead}회</b></>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <span className='ml-auto flex gap-2 text-xs'>
                        {/* 카드가 이미 Link 라 앵커를 중첩할 수 없다 — 클라이언트 내비게이션으로 이동한다 */}
                        {o.schoolId && (
                          <button className='text-primary hover:underline'
                            onClick={() =>
                              router.push(
                                buildAnalysisRoute({
                                  schoolId: o.schoolId ?? '',
                                  bidNumber: o.bidNo,
                                  rate: m?.rate != null ? String(m.rate) : undefined,
                                  baseAmount: m?.rate != null ? String(o.basePrice ?? '') : undefined
                                })
                              )
                            }>
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
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {o.sigungu} · {o.categorySrc === 'none'
                      ? '품목 미표기'
                      : (o.categories?.length ?? 0) > 1
                        ? `종합 ${o.categories!.length}품목 (${o.categories!.join(' · ')})`
                        : o.category}
                    {o.categorySrc === 'name_rule' && ' · 공고명에서 추정'}
                  </span>
                </span>
                <span className='text-muted-foreground shrink-0'>
                  하한 {o.floorRate} · {won(o.anchorAmount)}원
                  <span className='text-destructive ml-2'>{deadlineText(o.bidEndAt) ?? ''}</span>
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
          {forecastFailed && <LoadError what='발주 예정' />}
          {!forecastFailed && forecast.length === 0 && (
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
