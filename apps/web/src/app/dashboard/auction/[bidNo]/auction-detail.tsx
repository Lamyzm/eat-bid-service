'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useMarks } from '@/lib/marks';
import { StripChart } from '@/components/strip-chart';
import { type RosterRow } from '@/components/roster-table';
import { useTrack, trackAction, trackOnce } from '@/lib/track';
import { won } from '@/lib/format';
import { CHART } from '@/lib/chart-colors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';


type Auction = { bidId: string; openedAt: string; floorRate: number | null; winRate: number | null; nValid: number; category: string | null };
type MyBid = { openedAt: string | null; floorRate: number | null; basePrice: number | null; bidRate: number | null; winRate: number | null; won: number };

export function AuctionDetail({ open, auctions, roster }: {
  open: any; auctions: Auction[]; roster: { rows: RosterRow[]; maxStreak: number };
}) {
  const { bizNos } = useWorkspace();
  const { marks, set } = useMarks();
  useTrack('auction');
  const mark = marks[open.bidNo];

  const floor = open.floorRate ?? 90;
  const sameFloor = auctions.filter(a => a.winRate != null && a.floorRate === floor);
  const points = sameFloor.map(a => ({ winRate: a.winRate!, openedAt: a.openedAt }));
  const band = open.band as { dense?: { lo: number; hi: number; pct: number }; n?: number } | null;
  // 자주 걸린 값 — 스트립과 동일 소스에서 계산 (0.01 반올림)
  const recur = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of points) { const k = Math.round(p.winRate * 100) / 100; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  }, [points]);

  // 몰림 지도 — 최근 14일 전 지역 투찰값 분포 (동가 위험)
  const [crowd, setCrowd] = useState<{ days: number; total: number; bins: { v: number; n: number }[] } | null>(null);
  useEffect(() => {
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
  const [rateStr, setRateStr] = useState<string>(mark?.rate ? String(mark.rate) : '');
  const [amtStr, setAmtStr] = useState<string>('');
  const base = open.basePrice ?? 0;
  const rate = parseFloat(rateStr);
  const liveRate = Number.isFinite(rate) ? rate : null;
  const belowFloor = liveRate != null && liveRate < floor;
  function onRate(v: string) {
    if (v.trim()) trackOnce('calc_input');
    setRateStr(v);
    const r = parseFloat(v);
    setAmtStr(Number.isFinite(r) && base ? String(Math.round(base * r / 100)) : '');
  }
  function onAmt(v: string) {
    const n = Number(v.replace(/[^0-9]/g, ''));
    setAmtStr(v);
    setRateStr(n && base ? (100 * n / base).toFixed(3) : '');
  }
  const dday = useMemo(() => {
    if (!open.deadline) return null;
    const ms = new Date(open.deadline).getTime() - Date.now();
    if (ms < 0) return '마감됨';
    const h = Math.floor(ms / 36e5);
    return h < 24 ? `마감 ${h}시간 전` : `마감 D-${Math.floor(h / 24)}`;
  }, [open.deadline]);

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      {/* 1. 헤더 */}
      <div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-sm'>{open.sigungu}</span>
          {open.category && <Badge variant='secondary'>{open.category}</Badge>}
          <Badge>자격 충족</Badge>
          <Badge variant='destructive'>{dday ?? '마감 미상'}</Badge>
        </div>
        <h1 className='mt-1 text-2xl font-semibold'>{open.schoolName}</h1>
        <div className='mt-2 flex flex-wrap items-end gap-x-8 gap-y-2'>
          <div>
            <div className='text-muted-foreground text-xs'>기초금액</div>
            <div className='text-3xl font-bold tabular-nums'>{won(open.basePrice)} 원</div>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>하한율</div>
            <div className='text-2xl font-semibold tabular-nums'>{floor}</div>
          </div>
          <div className='text-muted-foreground text-sm'>
            전국 137개 시군구 · 공고 10만 건 · 투찰 694만 데이터 기준
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

      {/* 1.5 이번 판 신호 */}
      <Card>
        <CardContent className='flex flex-wrap gap-x-6 gap-y-1 py-3 text-[15px] tabular-nums'>
          <span>이 학교 최근 참여 <b>{recent3N.join('곳 → ') || '-'}곳</b></span>
          {sameDeadline != null && sameDeadline > 1 && (
            <span>같은 날 마감 공고 <b>{sameDeadline}건</b> <span className='text-muted-foreground'>— 경쟁이 분산되는 날</span></span>
          )}
          {open.usualN != null && <span>보통 <b>{open.usualN}곳</b> 참여</span>}
        </CardContent>
      </Card>

      {/* 2. 이 학교의 과거 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>과거 낙찰 기록</CardTitle>
          {band?.dense && (
            <CardDescription className='text-foreground text-[15px]'>
              하한 {floor} 기준 <b>{band.n}회 중 {Math.round((band.dense.pct / 100) * (band.n ?? 0))}회</b>가{' '}
              <b className='tabular-nums'>{band.dense.lo.toFixed(2)}~{band.dense.hi.toFixed(2)} </b>에서 낙찰 ·
              금액 환산 <b className='tabular-nums'>
                {won(base * band.dense.lo / 100)}~{won(base * band.dense.hi / 100)}원</b>
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
              denseLo={band?.dense?.lo ?? null} denseHi={band?.dense?.hi ?? null}
              myPast={myPastSameFloor} liveValue={liveRate} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              동일 하한 기록 {points.length}회: {points.map(p => p.winRate.toFixed(2)).join(', ') || '없음'}
            </p>
          )}
          {open.schoolId && (
            <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}?bidNo=${encodeURIComponent(open.bidNo)}${liveRate != null ? `&rate=${liveRate}&base=${base}` : ''}`}
              className='text-primary text-sm font-semibold hover:underline'>이 학교 분석판 (기록·리허설·리플레이) →</Link>
          )}
        </CardContent>
      </Card>

      {/* 3. 참여 업체 — 1줄 요약 (상세는 분석판) */}
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]'>
          <span>
            보통 <b>{open.usualN ?? '-'}곳</b> 참여
            {roster.rows[0] && <> · 최다 낙찰 <b>{roster.rows[0].name}</b> ({roster.rows[0].winN}회)</>}
            {roster.maxStreak <= 1 && roster.rows.length > 0 && <span className='text-muted-foreground'> · 2연속 낙찰 없음</span>}
          </span>
          {open.schoolId && (
            <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}`}
              className='text-primary text-sm hover:underline'>참여 업체 전체 →</Link>
          )}
        </CardContent>
      </Card>

      {/* 4. 내 전적 */}
      {bizNos.length > 0 ? my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>내 기록</CardTitle></CardHeader>
          <CardContent className='text-[15px]'>
            <b>{my.length}번</b> 참여 — 낙찰 <b>{myWins}</b> · 밀림 <b className='text-amber-600'>{myPushed}</b> · 무효 <b className='text-destructive'>{myBelow}</b>
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

      {/* 5. 결정 */}
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
                placeholder={`예: ${(floor + 0.05).toFixed(2)}`} className='w-36 font-mono text-lg' inputMode='decimal' />
            </div>
            <div className='text-muted-foreground pb-2'>↔</div>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>금액 (원)</div>
              <Input value={amtStr ? Number(amtStr.replace(/[^0-9]/g, '')).toLocaleString() : ''}
                onChange={e => onAmt(e.target.value)} placeholder='금액 입력'
                className='w-48 font-mono text-lg' inputMode='numeric' />
            </div>
          </div>
          {belowFloor && (
            <p className='text-destructive font-semibold'>하한({floor}) 미만 · 무효</p>
          )}
          {crowd && liveRate != null && (() => {
            const k = Math.round(liveRate * 100) / 100;
            const n = crowd.bins.find(b => Math.abs(b.v - k) < 1e-9)?.n ?? 0;
            return (
              <p className='text-[13px] tabular-nums'>
                이 값 자리에 최근 {crowd.days}일 <b className={n > 200 ? 'text-destructive' : 'text-primary'}>{n.toLocaleString()}건</b>
                {n === 0 ? ' — 빈 자리' : ''} <span className='text-muted-foreground'>(전장 {crowd.total.toLocaleString()}건의 사실 · 동가는 추첨)</span>
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
              <p className='text-[14px] tabular-nums'>
                이 값으로 과거 {same.length}회 재생 —{' '}
                <b className='text-amber-600'>밀림 {push}</b> ·{' '}
                <b className='text-primary'>낙찰 {win}</b>
                {alive > 0 && <> · <b style={{ color: CHART.me }}>기회 {alive}</b></>} ·{' '}
                <b className='text-destructive'>무효 {dead}</b>
                {open.schoolId && (
                  <Link href={`/dashboard/analysis/${encodeURIComponent(open.schoolId)}`}
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
            <Button variant={mark?.s === 'done' ? 'default' : 'outline'}
              disabled={belowFloor}
              onClick={() => { if (mark?.s !== 'done') trackAction('mark_done'); set(open.bidNo, mark?.s === 'done' ? null : { s: 'done', rate: liveRate ?? undefined }); }}>
              {mark?.s === 'done' ? `✓ 투찰함${mark.rate ? ` (${mark.rate})` : ''}` : '투찰 완료 표시'}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            개찰 후 결과가 자동 반영됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
