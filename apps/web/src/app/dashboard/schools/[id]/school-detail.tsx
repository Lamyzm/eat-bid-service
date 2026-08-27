'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import type { SchoolSummary, FloorStat, MyBidRow } from '@eatbid/shared';
import { RosterTable, type RosterRow } from '@/components/roster-table';
import { TimeDotChart } from '@/components/time-dot-chart';
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
const PL = ['최저', '낮은편', '중간', '높은편', '최고'];

type Auction = {
  bidId: string; openedAt: string; floorRate: number | null; basePrice: number | null;
  winRate: number | null; nValid: number; winnerName: string | null; category: string | null;
};

export function SchoolDetail({ school, auctions, prefillBase, prefillFloor }: {
  school: SchoolSummary | null; auctions: Auction[];
  prefillBase: number | null; prefillFloor: number | null;
}) {
  const { bizNos } = useWorkspace();
  const byFloor = (school?.byFloor ?? {}) as Record<string, FloorStat>;
  const floors = Object.keys(byFloor).map(Number).sort((a, b) => b - a);

  // 발주 예보 (클라 계산: 최근 간격 중앙값)
  const forecast = useMemo(() => {
    const dates = auctions.map(a => a.openedAt).sort();
    if (dates.length < 4) return null;
    const recent = dates.slice(-7);
    const gaps = recent.slice(1).map((d, i) =>
      Math.round((+new Date(d) - +new Date(recent[i])) / 864e5)).filter(g => g > 5 && g < 90).sort((a, b) => a - b);
    if (!gaps.length) return null;
    const med = gaps[Math.floor(gaps.length / 2)];
    const last = dates[dates.length - 1];
    const expected = new Date(+new Date(last) + med * 864e5);
    const due = Math.round((+expected - Date.now()) / 864e5);
    return { med, last, expected: expected.toISOString().slice(0, 10), due };
  }, [auctions]);

  // 이 학교의 열린 공고
  const [openBid, setOpenBid] = useState<{ bidNo: string } | null>(null);
  useEffect(() => {
    if (!school) return;
    fetch('/api/open').then(r => r.json()).then((rows: any[]) => {
      setOpenBid(rows.find(r => r.schoolId === school.id) ?? null);
    });
  }, [school]);

  // 로스터 + 내 전적
  const [roster, setRoster] = useState<{ rows: RosterRow[]; maxStreak: number }>({ rows: [], maxStreak: 0 });
  const [my, setMy] = useState<MyBidRow[]>([]);
  useEffect(() => {
    if (!school) return;
    fetch(`/api/schools/${encodeURIComponent(school.id)}/roster`).then(r => r.json()).then(setRoster);
  }, [school]);
  useEffect(() => {
    if (!school || bizNos.length === 0) return;
    fetch(`/api/schools/${encodeURIComponent(school.id)}/my-bids?bizNos=${bizNos.join(',')}`)
      .then(r => r.json()).then(setMy);
  }, [school, bizNos]);

  const myByKey = useMemo(() => {
    const m = new Map<string, MyBidRow>();
    for (const b of my) if (b.openedAt) m.set(`${b.openedAt}|${b.floorRate}`, b);
    return m;
  }, [my]);
  const myWins = my.filter(m => m.won).length;
  const myBelow = my.filter(m => !m.won && m.bidRate != null && m.floorRate != null && m.bidRate < m.floorRate).length;
  const myPushed = my.length - myWins - myBelow;

  const chartPoints = useMemo(() => auctions
    .filter(a => a.winRate != null)
    .map(a => ({
      openedAt: a.openedAt, winRate: a.winRate!, floorRate: a.floorRate, nValid: a.nValid,
      myRate: myByKey.get(`${a.openedAt}|${a.floorRate}`)?.bidRate ?? null,
    })), [auctions, myByKey]);
  const denseByFloor = useMemo(() => {
    const out: Record<string, { lo: number; hi: number } | undefined> = {};
    for (const [k, st] of Object.entries(byFloor)) out[String(parseFloat(k))] = st.dense ?? undefined;
    return out;
  }, [byFloor]);

  // 가정 계산기 (맨 아래 보조)
  const [base, setBase] = useState<string>(String(prefillBase ?? school?.medBase ?? ''));
  const [floorSel, setFloorSel] = useState<number>(prefillFloor ?? floors[0] ?? 90);
  const baseN = Number(String(base).replace(/[^0-9]/g, '')) || 0;
  const rsd = (school as any)?.rsd ?? 0.0076;
  const anchor = Math.round(baseN * floorSel / 100);

  if (!school) return <div className='p-8'>학교를 찾지 못했습니다.</div>;

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      {/* 1. 헤더 + 예보/열린공고 */}
      <div>
        <div className='text-muted-foreground text-xs'>{school.sido} {school.sigungu}</div>
        <h1 className='text-2xl font-semibold'>{school.name}</h1>
        <div className='mt-1'>
          <Link href={`/dashboard/analysis/${encodeURIComponent(school.id)}`}
            className='text-primary text-sm font-semibold hover:underline'>분석판 열기 →</Link>
        </div>
        <p className='text-muted-foreground text-sm tabular-nums'>
          공고 {school.nAuctions}건 · 보통 {school.medField}곳 참여
          {forecast && <> · 보통 {forecast.med}일 간격</>}
        </p>
      </div>

      {openBid ? (
        <Card className='border-primary'>
          <CardContent className='flex flex-wrap items-center justify-between gap-3 py-4'>
            <div className='font-semibold'>진행 중인 공고 1건</div>
            <Button onClick={() => { window.location.href = `/dashboard/auction/${openBid.bidNo}`; }}>
              공고 상세 →
            </Button>
          </CardContent>
        </Card>
      ) : forecast && (
        <Card>
          <CardContent className='py-4 text-[15px]'>
            발주 주기 <b>{forecast.med}일</b> · 지난 발주 {forecast.last} · 다음 예상{' '}
            <b>{forecast.due <= 0 ? '도래' : `${forecast.expected} (D-${forecast.due})`}</b>
            <span className='text-muted-foreground'> · 최근 발주 간격 기준</span>
          </CardContent>
        </Card>
      )}

      {/* 2. 잘 나온 구간 — 하한별 */}
      <div>
        <h2 className='mb-2 font-semibold'>낙찰률 분포 <span className='text-muted-foreground text-sm font-normal'>(하한별)</span></h2>
        <div className='grid gap-3 md:grid-cols-2'>
          {floors.map(f => {
            const st = byFloor[String(f)] ?? byFloor[f.toFixed(1)];
            if (!st) return null;
            return (
              <Card key={f}>
                <CardHeader className='pb-1'>
                  <CardDescription>하한 {f} · {st.n}공고</CardDescription>
                  <CardTitle className='text-2xl tabular-nums'>
                    {st.dense ? `${st.dense.lo.toFixed(2)} – ${st.dense.hi.toFixed(2)}` : '—'}
                  </CardTitle>
                  <CardDescription>{st.n}회 중 {st.dense ? Math.round(st.dense.pct / 100 * st.n) : 0}회 해당 · 평균 {st.mean.toFixed(3)}</CardDescription>
                </CardHeader>
                <CardContent className='space-y-2'>
                  <div className='grid grid-cols-5 gap-px rounded border text-center text-xs'>
                    {st.p.map((v, i) => (
                      <div key={i} className='bg-card p-1.5'>
                        <div className='font-mono font-semibold tabular-nums'>{v.toFixed(2)}</div>
                        <div className='text-muted-foreground'>{PL[i]}</div>
                      </div>
                    ))}
                  </div>
                  <div className='flex flex-wrap gap-1.5'>
                    {st.recur.filter(([, c]) => c >= 2).slice(0, 5).map(([v, c]) => (
                      <Badge key={v} variant='secondary' className='font-mono tabular-nums'>{v.toFixed(2)} ×{c}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 3. 회차 흐름 차트 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>회차별 낙찰률</CardTitle>
        </CardHeader>
        <CardContent>
          <TimeDotChart points={chartPoints} denseByFloor={denseByFloor} />
        </CardContent>
      </Card>

      {/* 4. 회차 기록 표 (몸통) */}
      <Card>
        <CardHeader className='pb-2'><CardTitle className='text-base'>낙찰 이력</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>날짜</TableHead><TableHead>품목</TableHead>
                  <TableHead className='text-right'>기초금액</TableHead>
                  <TableHead className='text-right'>하한</TableHead>
                  <TableHead className='text-right'>낙찰률</TableHead>
                  <TableHead>낙찰 업체</TableHead>
                  <TableHead className='text-right'>참여</TableHead>
                  <TableHead className='text-right'>내 투찰</TableHead>
                  <TableHead className='text-right'>차이</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...auctions].reverse().map(a => {
                  const mine = myByKey.get(`${a.openedAt}|${a.floorRate}`);
                  const diff = mine?.bidRate != null && a.winRate != null ? +(mine.bidRate - a.winRate).toFixed(3) : null;
                  return (
                    <TableRow key={a.bidId} className={mine ? 'bg-primary/5' : ''}>
                      <TableCell className='tabular-nums'>{a.openedAt}</TableCell>
                      <TableCell>{a.category ?? '-'}</TableCell>
                      <TableCell className='text-right tabular-nums'>{won(a.basePrice)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{a.floorRate}</TableCell>
                      <TableCell className='text-right font-mono tabular-nums'>{a.winRate?.toFixed(3) ?? '-'}</TableCell>
                      <TableCell>{a.winnerName ?? '-'}</TableCell>
                      <TableCell className='text-right tabular-nums'>{a.nValid}곳</TableCell>
                      <TableCell className='text-right font-mono tabular-nums'>{mine?.bidRate?.toFixed(3) ?? ''}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${diff == null ? '' : mine?.won ? 'text-green-600' : diff > 0 ? 'text-amber-600' : 'text-destructive'}`}>
                        {mine?.won ? '낙찰' : diff != null ? (diff > 0 ? `+${diff}` : diff) : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 5. 단골 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>참여 업체</CardTitle>
          <CardDescription>
            최근 참여 이력 기준.
            {roster.maxStreak <= 1 && roster.rows.length > 0 && ' 2연속 낙찰 사례 없음.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='p-0'>
          <RosterTable rows={roster.rows} limit={15} />
        </CardContent>
      </Card>

      {/* 6. 내 전적 요약 */}
      {my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>내 기록</CardTitle></CardHeader>
          <CardContent className='text-[15px]'>
            <b>{my.length}번</b> 참여 — 낙찰 <b>{myWins}</b> · 밀림 <b className='text-amber-600'>{myPushed}</b> · 무효 <b className='text-destructive'>{myBelow}</b>
            {myPushed > myBelow + 1 && <div className='text-destructive mt-1 font-medium'>이 학교 평균 투찰이 높은 편입니다.</div>}
          </CardContent>
        </Card>
      )}

      {/* 7. 가정 계산기 (보조) */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>하한 금액 계산</CardTitle>
          <CardDescription>기초금액 가정 시 하한 금액.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          <div className='flex flex-wrap items-end gap-3'>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>가정 기초금액 (원)</div>
              <Input value={Number(baseN).toLocaleString()} onChange={e => setBase(e.target.value)} className='w-44 font-mono' />
            </div>
            <div className='flex gap-1'>
              {(floors.length ? floors : [90, 88]).map(f => (
                <Button key={f} size='sm' variant={floorSel === f ? 'default' : 'outline'} onClick={() => setFloorSel(f)}>{f}</Button>
              ))}
            </div>
          </div>
          <div className='text-lg tabular-nums'>
            하한 금액 <b className='text-primary'>{won(anchor)}원</b>
            <span className='text-muted-foreground text-sm'> · 과거 실제 하한 범위 {won(anchor * (1 - 2 * rsd))}~{won(anchor * (1 + 2 * rsd))}원</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
