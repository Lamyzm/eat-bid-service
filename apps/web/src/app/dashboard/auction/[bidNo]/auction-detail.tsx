'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useMarks } from '@/lib/marks';
import { StripChart } from '@/components/strip-chart';
import { type RosterRow } from '@/components/roster-table';
import { useTrack, trackAction, trackOnce } from '@/lib/track';
import { won } from '@/lib/format';
import { pickBand, bandBasisText } from '@/lib/band';
import { deadlineText, isNotStarted } from '@/lib/deadline';
import { kstDate, kstTime } from '@eatbid/shared';
import { DataScope } from '@/components/data-scope';
import { CHART } from '@/lib/chart-colors';
import { slotKeysFor, ratesOf, bizLabelOf } from '@/lib/mark-rates';
import { usePersistedChoice } from '@/lib/use-persisted-state';
import { useSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';


const TABS = ['school', 'market', 'mine'] as const;

type Auction = { bidId: string; openedAt: string; floorRate: number | null; winRate: number | null; nValid: number; category: string | null };
type MyBid = { openedAt: string | null; floorRate: number | null; basePrice: number | null; bidRate: number | null; winRate: number | null; won: number };

export function AuctionDetail({ open, auctions, roster, initialRate }: {
  open: any; auctions: Auction[]; roster: { rows: RosterRow[]; maxStreak: number };
  initialRate?: string | null;
}) {
  const { bizNos } = useWorkspace();
  const { marks, set } = useMarks();
  useTrack('auction');
  const { bizNames } = useSession();
  const [tab, setTab] = usePersistedChoice('eatbid.auctionTab', 'school', TABS);
  const mark = marks[open.bidNo];

  // 하한을 모르면 지어내지 않는다. 모르는 값으로 비교 문장을 만들면 단언이 된다.
  const floor = open.floorRate;
  // 품목별 값이 있으면 그걸 쓴다 (전 품목 합산 대신)
  const picked = pickBand(open);
  const sameFloor = auctions.filter(a => a.winRate != null && a.floorRate === floor);
  const points = sameFloor.map(a => ({ winRate: a.winRate!, openedAt: a.openedAt }));
  // 자주 걸린 값 — 스트립과 동일 소스에서 계산 (0.01 반올림)
  const recur = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of points) { const k = Math.round(p.winRate * 100) / 100; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  }, [points]);

  // 몰림 지도 — 최근 14일 전 지역 투찰값 분포 (동가 위험)
  const [crowd, setCrowd] = useState<{ days: number; total: number; bins: { v: number; n: number }[] } | null>(null);
  useEffect(() => {
    if (floor == null) return;
    fetch(`/api/wins/crowd?days=14&floor=${floor}`).then(r => r.json()).then(setCrowd).catch(() => {});
  }, [floor]);
  // 이번 판 신호 — 같은 마감일 공고 수 (경쟁 분산)
  const [openAll, setOpenAll] = useState<any[]>([]);
  useEffect(() => { fetch('/api/open').then(r => r.json()).then(x => setOpenAll(Array.isArray(x) ? x : [])); }, []);
  const sameDeadline = useMemo(() => {
    if (!open.deadline) return null;
    const d = String(open.deadline).slice(0, 10);
    return openAll.filter(o => o.deadline && String(o.deadline).slice(0, 10) === d).length;
  }, [openAll, open.deadline]);
  const recent3N = useMemo(() => auctions.filter(a => a.winRate != null).slice(-3).map(a => a.nValid), [auctions]);

  // 회차 경계 (리허설 미니 — 예정가 기반 확정 판정)
  const [rounds, setRounds] = useState<{ winRate: number | null; floorRate: number | null; effFloor: number | null; maxInvalid: number | null }[]>([]);
  useEffect(() => {
    if (!open.schoolId) return;
    fetch(`/api/rounds/school/${encodeURIComponent(open.schoolId)}`)
      .then(r => r.json()).then(xs => setRounds(Array.isArray(xs) ? xs : [])).catch(() => {});
  }, [open.schoolId]);

  // 내 전적 (이 학교)
  const [my, setMy] = useState<MyBid[]>([]);
  useEffect(() => {
    if (!open.schoolId || bizNos.length === 0) return;
    fetch(`/api/schools/${encodeURIComponent(open.schoolId)}/my-bids?bizNos=${bizNos.join(',')}`)
      .then(r => r.json()).then(setMy);
  }, [open.schoolId, bizNos]);
  const myWins = my.filter(m => m.won).length;
  const myBelow = my.filter(m => !m.won && m.bidRate != null && m.floorRate != null && m.bidRate < m.floorRate).length;
  const myPushed = my.length - myWins - myBelow;
  const myPastSameFloor = my.filter(m => m.floorRate === floor && m.bidRate != null).map(m => m.bidRate!);

  // 계산기 — 투찰률 ↔ 금액 양방향
  // 하이드레이션 안전: 초기값은 서버가 준 rate만 (localStorage 값은 마운트 후 주입)
  const [rateStr, setRateStr] = useState<string>(initialRate ?? '');
  const [amtStr, setAmtStr] = useState<string>('');
  const seededRef = useRef(false);   // 값을 실제로 채웠을 때만 닫는다 (U35)
  const touchedRef = useRef(false);  // 사용자가 손대면 더 이상 덮어쓰지 않는다
  useEffect(() => {
    if (seededRef.current || touchedRef.current) return;
    // marks 는 세션 스토어에서 늦게 도착한다 — 값이 올 때까지 주입 기회를 열어 둔다
    const seed = initialRate ?? (mark?.rate != null ? String(mark.rate) : '');
    if (!seed) return;
    seededRef.current = true;
    setRateStr(seed);
    const r = parseFloat(seed);
    setAmtStr(Number.isFinite(r) && open.basePrice ? String(Math.round(open.basePrice * r / 100)) : '');
  }, [mark?.rate, initialRate, open.basePrice]);
  const base = open.basePrice ?? 0;
  const rate = parseFloat(rateStr);
  const liveRate = Number.isFinite(rate) ? rate : null;
  const belowFloor = liveRate != null && floor != null && liveRate < floor;
  function onRate(v: string) {
    touchedRef.current = true;
    if (v.trim()) trackOnce('calc_input');
    setRateStr(v);
    const r = parseFloat(v);
    setAmtStr(Number.isFinite(r) && base ? String(Math.round(base * r / 100)) : '');
  }
  function onAmt(v: string) {
    touchedRef.current = true;
    const n = Number(v.replace(/[^0-9]/g, ''));
    setAmtStr(v);
    setRateStr(n && base ? (100 * n / base).toFixed(3) : '');
  }
  // 시각 의존 값은 마운트 후에만 (SSR/CSR 불일치 방지 — React #418)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // 시각 의존 값이라 마운트 후에만 (SSR/CSR 불일치 방지 — React #418)
  const dday = useMemo(
    () => (mounted ? deadlineText(open.bidEndAt) : null),
    [mounted, open.bidEndAt]);

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      {/* 1. 헤더 */}
      <div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-sm'>{open.sigungu}</span>
          {open.category && <Badge variant='secondary'>{open.category}</Badge>}
          {/* 자격은 서버 값으로만 말한다. 조건 없이 '자격 충족'이라 단언하고 있었다 */}
          {open.unrestricted
            ? <Badge variant='outline'>지역 제한 없음</Badge>
            : open.allowedLabel
              ? <Badge variant='outline'>{open.allowedLabel} 제한</Badge>
              : null}
          {dday && <Badge variant='destructive'>{dday}</Badge>}
        </div>
        <h1 className='mt-1 text-2xl font-semibold'>{open.schoolName}</h1>
        {mounted && isNotStarted(open.bidBeginAt) && (
          <p className='text-muted-foreground mt-1 text-sm'>
            {kstDate(new Date(open.bidBeginAt)).slice(5)} {kstTime(new Date(open.bidBeginAt))}부터 투찰합니다.
          </p>
        )}
        {!open.unrestricted && open.allowedLabel && (
          <p className='text-muted-foreground mt-1 text-sm'>
            참가 자격은 사무소 소재지 기준입니다. 자격 여부는 확인이 필요합니다.
          </p>
        )}
        <div className='mt-2 flex flex-wrap items-end gap-x-8 gap-y-2'>
          <div>
            <div className='text-muted-foreground text-xs'>공고 기초금액</div>
            <div className='text-3xl font-bold tabular-nums'>{won(open.basePrice)} 원</div>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>하한율</div>
            <div className='text-2xl font-semibold tabular-nums'>{floor ?? '—'}</div>
          </div>
          <div className='text-muted-foreground text-sm'>
            <DataScope />
          </div>
          <div className='flex items-center gap-2 text-sm'>
            <span className='text-muted-foreground font-mono'>공고번호 {open.bidNo}</span>
            <Button size='sm' variant='outline'
              onClick={() => {
                navigator.clipboard?.writeText(open.bidNo);
                window.open('https://ns.eat.co.kr', '_blank');
              }}>
              공고 원문 찾기 ↗ <span className='text-muted-foreground ml-1 text-xs'>번호 자동 복사</span>
            </Button>
            <span className='text-muted-foreground text-xs'>
              NeaT 로그인 → 입찰정보 → 입찰공고 → 복사된 번호 붙여넣기
            </span>
          </div>
        </div>
      </div>

      {/* 2. 결정 — 계산기 (U4: 결정이 먼저) */}
      <Card className='border-primary'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>투찰 계산기</CardTitle>
          <CardDescription>입력한 값이 위 차트에 표시됩니다.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-end gap-3'>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>투찰률</div>
              <Input value={rateStr} onChange={e => onRate(e.target.value)}
                placeholder={floor != null ? `예: ${(floor + 0.05).toFixed(2)}` : '투찰률'} className='w-36 font-mono text-lg' inputMode='decimal' />
            </div>
            <div className='text-muted-foreground pb-2'>↔</div>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>내가 넣을 금액 (원)</div>
              <Input value={amtStr ? Number(amtStr.replace(/[^0-9]/g, '')).toLocaleString() : ''}
                onChange={e => onAmt(e.target.value)} placeholder='금액 입력'
                className='w-48 font-mono text-lg' inputMode='numeric' />
            </div>
          </div>
          {belowFloor && (
            <p className='text-destructive font-semibold'>하한({floor}) 아래입니다</p>
          )}
          {crowd && liveRate != null && (() => {
            const k = Math.round(liveRate * 100) / 100;
            const n = crowd.bins.find(b => Math.abs(b.v - k) < 1e-9)?.n ?? 0;
            return (
              <p className='text-[13px] tabular-nums'>
                이 값 자리에 최근 {crowd.days}일 <b className={n > 200 ? 'text-destructive' : 'text-primary'}>{n.toLocaleString()}건</b>
                {n === 0 ? ' — 빈 자리' : ''} <span className='text-muted-foreground'>(전국 최근 {crowd.days}일 {crowd.total.toLocaleString()}건 기준 · 같은 값은 추첨)</span>
              </p>
            );
          })()}
          {liveRate != null && !belowFloor && (() => {
            const same = rounds.filter(x => x.floorRate === floor && x.winRate != null);
            if (same.length < 3) return null;
            let push = 0, win = 0, alive = 0, dead = 0;
            for (const x of same) {
              if (liveRate >= x.winRate!) push++;
              else if (x.effFloor != null) (liveRate < x.effFloor ? dead++ : win++);
              else if (x.maxInvalid != null && liveRate <= x.maxInvalid) dead++;
              else alive++;
            }
            return (
              <p className='text-[14px] leading-relaxed tabular-nums'>
                이 값이면 과거 {same.length}회 중:{' '}
                남이 더 낮게 써서 밀린 게 <b className='text-pushed'>{push}회</b> ·{' '}
                내가 먹었을 게 <b className='text-primary'>{win}회</b>
                {alive > 0 && <> · 예정가 추첨이 갈랐을 게 <b style={{ color: CHART.me }}>{alive}회</b></>} ·{' '}
                내 값이 하한 아래였던 게 <b className='text-destructive'>{dead}회</b>
                {open.schoolId && (
                  <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}?bidNo=${encodeURIComponent(open.bidNo)}${liveRate != null ? `&rate=${liveRate}&base=${base}` : ''}`}
                    className='text-primary ml-2 text-xs hover:underline'>분석판 상세 →</Link>
                )}
              </p>
            );
          })()}
          <div className='flex flex-wrap gap-2 pt-1'>
            <Button variant={mark?.s === 'watch' ? 'default' : 'outline'}
              onClick={() => set(open.bidNo, mark?.s === 'watch' ? null : { s: 'watch' })}>
              {mark?.s === 'watch' ? '★ 관심' : '☆ 관심'}
            </Button>
            {(() => {
              const saved = mark?.s === 'done';
              const changed = saved && liveRate != null && liveRate !== mark?.rate;
              return (
                <Button variant={saved && !changed ? 'secondary' : 'default'} disabled={belowFloor}
                  onClick={() => {
                    const r = liveRate ?? mark?.rate;
                    trackAction(!saved ? 'mark_done' : 'mark_update',
                      { bidNo: open.bidNo, rate: r ?? undefined, from: 'auction' });
                    set(open.bidNo, { s: 'done', rate: r });
                  }}>
                  {(() => {
                    if (!saved) return '투찰 저장';
                    if (changed) return '이 값으로 갱신';
                    const slots = slotKeysFor(mark, bizNos);
                    const rates = ratesOf(mark, bizNos);
                    const parts = slots.filter(k => rates[k] != null).map(k =>
                      slots.length > 1 ? `${bizLabelOf(k, bizNames, true)} ${rates[k]}` : `${rates[k]}`);
                    return `✓ 저장됨 (${parts.join(' · ')})`;
                  })()}
                </Button>
              );
            })()}
            {mark?.s === 'done' && (
              <Button variant='ghost' size='sm'
                onClick={() => {
                  trackAction('mark_undone', { bidNo: open.bidNo, rate: mark?.rate, from: 'auction' });
                  set(open.bidNo, { s: 'watch', rate: mark?.rate });
                }}>해제</Button>
            )}
          </div>
          {(() => {
            // 사업자가 둘 이상이면 계산기 값이 누구 것인지 밝힌다 (오늘 화면과 다른 말을 하지 않도록)
            const slots = slotKeysFor(mark, bizNos);
            if (slots.length < 2) return null;
            const rates = ratesOf(mark, bizNos);
            const filled = slots.filter(k => rates[k] != null);
            if (filled.length === 0) return null;
            return (
              <p className='text-muted-foreground text-xs tabular-nums'>
                계산기는 <b className='text-foreground'>{bizLabelOf(filled[0], bizNames, true)}</b> 값입니다.
                {filled.length > 1 && <> 다른 사업자 값은 오늘 화면에서 고칩니다.</>}
              </p>
            );
          })()}
          <p className='text-muted-foreground text-xs'>
            [투찰 저장]을 누르면 개찰 후 결과가 자동 반영됩니다. 값을 고치면 [이 값으로 갱신]이 뜹니다.
          </p>
        </CardContent>
      </Card>

      {/* 탭 — 결정 블록은 위에 고정, 읽을거리는 탭으로 (R3) */}
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList variant='line'>
          <TabsTrigger value='school'>이 학교</TabsTrigger>
          <TabsTrigger value='market'>요즘 시장</TabsTrigger>
          <TabsTrigger value='mine'>내 리허설</TabsTrigger>
        </TabsList>

        <TabsContent value='school' className='mt-3 space-y-4'>
      {/* 4. 이 학교의 과거 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>과거 낙찰 기록</CardTitle>
          {picked.band?.dense && (
            <CardDescription className='text-foreground text-[15px]'>
              <span className='text-muted-foreground text-xs'>{bandBasisText(picked)}</span><br />
              <b>{picked.n}회 중 {Math.round((picked.band.dense.pct / 100) * picked.n)}회</b>가{' '}
              <b className='tabular-nums'>{picked.band.dense.lo.toFixed(2)}~{picked.band.dense.hi.toFixed(2)} </b>에서 낙찰 ·
              금액 환산 <b className='tabular-nums'>
                {won(base * picked.band.dense.lo / 100)}~{won(base * picked.band.dense.hi / 100)}원</b>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className='space-y-3'>
          {recur.length > 0 && (
            <div className='flex flex-wrap items-center gap-1.5 text-sm'>
              <span className='text-muted-foreground'>자주 걸린 값:</span>
              {recur.map(([v, c]) => (
                <Badge key={v} variant='secondary' className='font-mono tabular-nums'>{v.toFixed(2)} ×{c}</Badge>
              ))}
            </div>
          )}
          {points.length >= 4 ? (
            <StripChart floor={floor} points={points}
              denseLo={picked.band?.dense?.lo ?? null} denseHi={picked.band?.dense?.hi ?? null}
              myPast={myPastSameFloor} liveValue={liveRate} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              {auctions.length === 0
                ? '이 학교는 지난 개찰 기록이 아직 없습니다.'
                : `동일 하한 기록 ${points.length}회${points.length ? `: ${points.map(p => p.winRate.toFixed(2)).join(', ')}` : ''}`}
            </p>
          )}
          {open.schoolId && (
            <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}?bidNo=${encodeURIComponent(open.bidNo)}${liveRate != null ? `&rate=${liveRate}&base=${base}` : ''}`}
              className='text-primary text-sm font-semibold hover:underline'>이 학교 분석판 (기록·리허설·리플레이) →</Link>
          )}
        </CardContent>
      </Card>

      {/* 5. 참여 업체 — 1줄 요약 (상세는 분석판) */}
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]'>
          <span>
            보통 <b>{open.usualN ?? '-'}곳</b> 참여
            {roster.rows[0] && <> · 최다 낙찰 <b>{roster.rows[0].name}</b> ({roster.rows[0].winN}회)</>}
            {roster.maxStreak <= 1 && roster.rows.length > 0 && <span className='text-muted-foreground'> · 2연속 낙찰 없음</span>}
          </span>
          {open.schoolId && (
            <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}?bidNo=${encodeURIComponent(open.bidNo)}${liveRate != null ? `&rate=${liveRate}&base=${base}` : ''}`}
              className='text-primary text-sm hover:underline'>참여 업체 전체 →</Link>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value='market' className='mt-3 space-y-4'>
      {/* 3. 이번 판 신호 */}
      <Card>
        <CardContent className='flex flex-wrap gap-x-6 gap-y-1 py-3 text-[15px] tabular-nums'>
          <span>이 학교 최근 참여 <b>{recent3N.join('곳 → ') || '-'}곳</b></span>
          {sameDeadline != null && sameDeadline > 1 && (
            <span>같은 날 마감 공고 <b>{sameDeadline}건</b> <span className='text-muted-foreground'>— 경쟁이 분산되는 날</span></span>
          )}
          {open.usualN != null && <span>보통 <b>{open.usualN}곳</b> 참여</span>}
        </CardContent>
      </Card>

          {crowd && (
            <Card>
              <CardContent className='py-3 text-[15px] tabular-nums'>
                전국 최근 {crowd.days}일, 하한 {floor} 공고에서 <b>{crowd.total.toLocaleString()}건</b>이 투찰됐습니다.
                {liveRate != null && (() => {
                  const k = Math.round(liveRate * 100) / 100;
                  const n = crowd.bins.find(b => Math.abs(b.v - k) < 1e-9)?.n ?? 0;
                  return <> 내 값 <b className='font-mono'>{k.toFixed(2)}</b> 자리에는 <b>{n.toLocaleString()}건</b>{n === 0 ? ' — 빈 자리' : ''}.</>;
                })()}
                {open.schoolId && (
                  <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}?bidNo=${encodeURIComponent(open.bidNo)}${liveRate != null ? `&rate=${liveRate}&base=${base}` : ''}`}
                    className='text-primary ml-2 text-sm hover:underline'>분포 자세히 →</Link>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value='mine' className='mt-3 space-y-4'>
      {/* 6. 내 전적 */}
      {bizNos.length > 0 ? my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>내 기록</CardTitle></CardHeader>
          <CardContent className='text-[15px]'>
            <b>{my.length}번</b> 참여 — 낙찰 <b>{myWins}</b> · 낙찰실패 <b>{myPushed + myBelow}</b>
            <span className='text-muted-foreground'>
              {' '}(그중 하한 아래 관찰 <b className='text-destructive'>{myBelow}</b>)
            </span>
            <div className='text-muted-foreground mt-1 text-xs'>발주처가 주는 값은 낙찰과 낙찰실패 둘뿐입니다. 하한 아래인지는 저희가 계산한 관찰입니다.</div>
            {myPushed > myBelow + 1 && <div className='text-destructive mt-1 font-medium'>이 학교 평균 투찰이 높은 편입니다.</div>}
          </CardContent>
        </Card>
      ) : (
        <Card className='border-dashed'>
          <CardContent className='text-muted-foreground py-4 text-sm'>
            사업자번호를 등록하면 이 학교에서의 내 기록이 표시됩니다.{' '}
            <Link href='/dashboard/my' className='text-primary hover:underline'>사업자 등록</Link>.
          </CardContent>
        </Card>
      )}

        </TabsContent>
      </Tabs>

    </div>
  );
}
