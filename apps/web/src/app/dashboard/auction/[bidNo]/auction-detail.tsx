'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useMarks } from '@/lib/marks';
import { StripChart } from '@/components/strip-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();

type Auction = { bidId: string; openedAt: string; floorRate: number | null; winRate: number | null; nValid: number; category: string | null };
type RosterRow = { bizNo: string; name: string; partN: number; winN: number; winRates: number[]; medRate: number | null };
type MyBid = { openedAt: string | null; floorRate: number | null; basePrice: number | null; bidRate: number | null; winRate: number | null; won: number };

export function AuctionDetail({ open, auctions, roster }: {
  open: any; auctions: Auction[]; roster: { rows: RosterRow[]; maxStreak: number };
}) {
  const { bizNos } = useWorkspace();
  const { marks, set } = useMarks();
  const mark = marks[open.bidNo];

  const floor = open.floorRate ?? 90;
  const sameFloor = auctions.filter(a => a.winRate != null && a.floorRate === floor);
  const points = sameFloor.map(a => ({ winRate: a.winRate!, openedAt: a.openedAt }));
  const flow5 = points.slice(-5).map(p => p.winRate.toFixed(2)).join(' → ');
  const band = open.band as { dense?: { lo: number; hi: number; pct: number }; recur?: [number, number][]; n?: number } | null;

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
          <Badge>자격 됩니다</Badge>
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
            전국 9.6만 공고 · 630만 투찰 위에서 계산됩니다
          </div>
        </div>
      </div>

      {/* 2. 이 학교의 과거 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>이 학교는 이렇게 나왔습니다</CardTitle>
          {band?.dense && (
            <CardDescription className='text-foreground text-[15px]'>
              같은 하한({floor}) <b>{band.n}회 중 {Math.round((band.dense.pct / 100) * (band.n ?? 0))}회</b>가{' '}
              <b className='tabular-nums'>{band.dense.lo.toFixed(2)}~{band.dense.hi.toFixed(2)}</b> 사이에서 낙찰 —
              이번 기초금액 기준 <b className='tabular-nums'>
                {won(base * band.dense.lo / 100)}~{won(base * band.dense.hi / 100)}원</b>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className='space-y-3'>
          {band?.recur && band.recur.filter(([, c]) => c >= 2).length > 0 && (
            <div className='flex flex-wrap items-center gap-1.5 text-sm'>
              <span className='text-muted-foreground'>자주 걸린 값:</span>
              {band.recur.filter(([, c]) => c >= 2).map(([v, c]) => (
                <Badge key={v} variant='secondary' className='font-mono tabular-nums'>{v.toFixed(2)} ×{c}</Badge>
              ))}
            </div>
          )}
          {flow5 && (
            <div className='text-sm tabular-nums'>
              <span className='text-muted-foreground'>최근 흐름:</span> <b>{flow5}</b>
            </div>
          )}
          {points.length >= 4 ? (
            <StripChart floor={floor} points={points}
              denseLo={band?.dense?.lo ?? null} denseHi={band?.dense?.hi ?? null}
              myPast={myPastSameFloor} liveValue={liveRate} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              같은 하한 기록이 {points.length}회뿐이라 그림 대신 값으로: {points.map(p => p.winRate.toFixed(2)).join(', ') || '없음'}
            </p>
          )}
          {open.schoolId && (
            <Link href={`/dashboard/schools/${encodeURIComponent(open.schoolId)}`}
              className='text-primary text-sm hover:underline'>이 학교 전체 기록 보기 →</Link>
          )}
        </CardContent>
      </Card>

      {/* 3. 누가 오나 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>보통 몇 곳이 옵니까</CardTitle>
          <CardDescription>
            보통 <b className='text-foreground'>{open.usualN ?? '-'}곳</b>이 들어옵니다 — 회차마다 들쭉날쭉합니다.
            {' '}누가 이길지는 아무도 모릅니다. 누가, 어디에 서는지는 보여드립니다.
            {roster.maxStreak <= 1 && roster.rows.length > 0 &&
              ' 이 학교에서 두 번 연속 낙찰한 업체는 없었습니다.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>업체</TableHead>
                  <TableHead className='text-right'>참여</TableHead>
                  <TableHead className='text-right'>낙찰</TableHead>
                  <TableHead>낙찰했던 값</TableHead>
                  <TableHead className='text-right'>보통 쓰는 자리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.rows.slice(0, 12).map(r => (
                  <TableRow key={r.bizNo}>
                    <TableCell className='font-medium'>{r.name}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.partN}회</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.winN}회</TableCell>
                    <TableCell className='font-mono text-sm tabular-nums'>
                      {(r.winRates ?? []).slice(0, 4).map(v => v.toFixed(2)).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className='text-right font-mono tabular-nums'>{r.medRate?.toFixed(2) ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 4. 내 전적 */}
      {bizNos.length > 0 ? my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>이 학교에서 나</CardTitle></CardHeader>
          <CardContent className='text-[15px]'>
            <b>{my.length}번</b> 참여 — 낙찰 <b>{myWins}</b> · 밀림 <b className='text-amber-600'>{myPushed}</b> · 무효 <b className='text-destructive'>{myBelow}</b>
            {myPushed > myBelow + 1 && <div className='text-destructive mt-1 font-medium'>이 학교에선 대체로 높게 쓰셨습니다.</div>}
          </CardContent>
        </Card>
      ) : (
        <Card className='border-dashed'>
          <CardContent className='text-muted-foreground py-4 text-sm'>
            이 학교에서의 당신 기록이 여기 나타납니다. 이미 저장돼 있습니다 —{' '}
            <Link href='/dashboard/my' className='text-primary hover:underline'>사업자번호만 넣으세요</Link>.
          </CardContent>
        </Card>
      )}

      {/* 5. 결정 */}
      <Card className='border-primary'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>얼마 쓰시겠습니까</CardTitle>
          <CardDescription>값을 넣으면 위 그림에 놓아드립니다.</CardDescription>
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
                onChange={e => onAmt(e.target.value)} placeholder='금액으로 입력해도 됩니다'
                className='w-48 font-mono text-lg' inputMode='numeric' />
            </div>
          </div>
          {belowFloor && (
            <p className='text-destructive font-semibold'>이 값은 하한({floor}) 아래 — 무효 처리됩니다.</p>
          )}
          <div className='flex flex-wrap gap-2 pt-1'>
            <Button variant={mark?.s === 'watch' ? 'default' : 'outline'}
              onClick={() => set(open.bidNo, mark?.s === 'watch' ? null : { s: 'watch' })}>
              {mark?.s === 'watch' ? '★ 관심' : '☆ 관심'}
            </Button>
            <Button variant={mark?.s === 'done' ? 'default' : 'outline'}
              disabled={belowFloor}
              onClick={() => set(open.bidNo, mark?.s === 'done' ? null : { s: 'done', rate: liveRate ?? undefined })}>
              {mark?.s === 'done' ? `✓ 투찰함${mark.rate ? ` (${mark.rate})` : ''}` : '이 공고에 투찰했다고 표시'}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            표시해 두면 내일 아침, 개찰 결과가 채점돼 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
