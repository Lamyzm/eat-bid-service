'use client';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import type { SchoolSummary, FloorStat, MyBidRow } from '@eatbid/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ZAxis
} from 'recharts';

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();
const PL = ['최저', '낮은편', '중간', '높은편', '최고'];

type Auction = {
  bidId: string; openedAt: string; floorRate: number | null;
  basePrice: number | null; winRate: number | null; nValid: number;
};

export function SchoolDetail({
  school, auctions, prefillBase, prefillFloor,
}: {
  school: SchoolSummary | null;
  auctions: Auction[];
  prefillBase: number | null;
  prefillFloor: number | null;
}) {
  const { bizNos } = useWorkspace();
  const byFloor = (school?.byFloor ?? {}) as Record<string, FloorStat>;
  const floors = Object.keys(byFloor).map(Number).sort((a, b) => b - a);

  // 기준 금액
  const [base, setBase] = useState<string>(String(prefillBase ?? school?.medBase ?? ''));
  const [floor, setFloor] = useState<number>(prefillFloor ?? floors[0] ?? 90);
  const baseN = Number(String(base).replace(/[^0-9]/g, '')) || 0;
  const anchor = Math.round(baseN * floor / 100);
  const rsd = (school as any)?.rsd ?? 0.0076;

  // 차트 필터
  const chartFloors = [...new Set(auctions.map(a => a.floorRate).filter((f): f is number => f != null))].sort((a, b) => b - a);
  const [cf, setCf] = useState<number | 'all'>(chartFloors[0] ?? 'all');
  const chartData = useMemo(() =>
    auctions
      .filter(a => a.winRate != null && (cf === 'all' || a.floorRate === cf))
      .map((a, i) => ({ i, winRate: a.winRate, date: a.openedAt })),
    [auctions, cf]);

  // 내 전적
  const [my, setMy] = useState<MyBidRow[]>([]);
  useEffect(() => {
    if (!school || bizNos.length === 0) return;
    fetch(`/api/schools/${encodeURIComponent(school.id)}/my-bids?bizNos=${bizNos.join(',')}`)
      .then(r => r.json()).then(setMy);
  }, [school, bizNos]);
  const myWins = my.filter(m => m.won).length;
  const myBelow = my.filter(m => !m.won && m.bidRate != null && m.floorRate != null && m.bidRate < m.floorRate).length;
  const myPushed = my.length - myWins - myBelow;

  if (!school) return <div className='p-8'>학교를 찾지 못했습니다.</div>;

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      <div>
        <div className='text-muted-foreground text-xs'>{school.sido} {school.sigungu}</div>
        <h1 className='text-2xl font-semibold'>{school.name}</h1>
        <p className='text-muted-foreground text-sm tabular-nums'>
          공고 {school.nAuctions}건 · 보통 업체 {school.medField}곳 참여
        </p>
      </div>

      {/* ① 기준 금액 */}
      <Card className='border-primary'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>① 이 공고의 하한 금액</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-end gap-3'>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>기초가격 (원)</div>
              <Input value={Number(baseN).toLocaleString()} onChange={e => setBase(e.target.value)}
                className='w-44 font-mono' />
            </div>
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>하한율</div>
              <div className='flex gap-1'>
                {(floors.length ? floors : [90, 88]).map(f => (
                  <Button key={f} size='sm' variant={floor === f ? 'default' : 'outline'}
                    onClick={() => setFloor(f)}>{f}</Button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>예상 하한 금액 (기초가 × 하한율)</div>
            <div className='text-primary text-3xl font-bold tabular-nums'>{won(anchor)} 원</div>
            <div className='text-muted-foreground mt-1 text-xs'>
              실제 하한은 개찰 때 추첨으로 정해집니다. 이 학교에서는 과거에
              <b className='text-foreground tabular-nums'> {won(anchor * (1 - 2 * rsd))} ~ {won(anchor * (1 + 2 * rsd))}원</b> 범위에서 정해졌습니다.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ② 내 투찰 버릇 */}
      {bizNos.length > 0 && my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>② 이 학교에서 나</CardTitle></CardHeader>
          <CardContent className='text-sm'>
            <b>{my.length}번</b> 투찰 · 낙찰 <b>{myWins}번</b>
            {my.length > myWins && <> · 진 이유: <b className='text-amber-600'>{myPushed}번 밀림</b>(더 낮게 쓴 업체에) · <b className='text-destructive'>{myBelow}번 하한 미달</b></>}
            {myPushed > myBelow + 1 && <div className='text-destructive mt-1 font-medium'>→ 이 학교에선 대체로 높게 쓰는 편입니다.</div>}
          </CardContent>
        </Card>
      )}

      {/* ③ 잘 나온 구간 */}
      <div>
        <h2 className='mb-2 font-semibold'>③ 낙찰이 잘 나온 구간 <span className='text-muted-foreground text-sm font-normal'>— 과거 기록. 여기 쓴다고 보장되는 건 아닙니다</span></h2>
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
                  <CardDescription>승자 {st.dense?.pct ?? 0}%가 이 구간 · 평균 {st.mean.toFixed(3)}</CardDescription>
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
                      <Badge key={v} variant='secondary' className='font-mono tabular-nums'>
                        {v.toFixed(2)}<span className='text-muted-foreground ml-1'>×{c}</span>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ④ 회차별 흐름 */}
      <Card>
        <CardHeader className='pb-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle className='text-base'>④ 회차별 낙찰률 흐름</CardTitle>
            <div className='flex gap-1'>
              <Button size='sm' variant={cf === 'all' ? 'default' : 'outline'} onClick={() => setCf('all')}>전체</Button>
              {chartFloors.map(f => (
                <Button key={f} size='sm' variant={cf === f ? 'default' : 'outline'} onClick={() => setCf(f)}>하한 {f}</Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className='h-64'>
          <ResponsiveContainer width='100%' height='100%'>
            <ScatterChart>
              <CartesianGrid strokeDasharray='3 3' opacity={0.3} />
              <XAxis dataKey='i' name='회차' fontSize={11} tickFormatter={() => ''} label={{ value: '← 과거 · 최근 →', position: 'insideBottom', fontSize: 11 }} />
              <YAxis dataKey='winRate' domain={['auto', 'auto']} fontSize={11} tickFormatter={(v: number) => v.toFixed(1)} width={44} />
              <ZAxis range={[28, 28]} />
              <Tooltip formatter={(v: any) => v} labelFormatter={() => ''}
                content={({ payload }) => payload?.length
                  ? <div className='bg-popover rounded border p-2 text-xs shadow'>{(payload[0].payload as any).date} · 낙찰률 {(payload[0].payload as any).winRate}</div>
                  : null} />
              <Scatter data={chartData} fill='var(--primary)' />
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ⑤ 내 전적 표 */}
      {my.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>⑤ 이 학교 내 투찰 전체</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>날짜</TableHead><TableHead className='text-right'>하한</TableHead>
                  <TableHead className='text-right'>기초가</TableHead>
                  <TableHead className='text-right'>내 투찰률</TableHead>
                  <TableHead className='text-right'>낙찰률</TableHead>
                  <TableHead className='text-right'>차이</TableHead>
                  <TableHead>결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...my].reverse().map((m, i) => {
                  const diff = m.bidRate != null && m.winRate != null ? +(m.bidRate - m.winRate).toFixed(3) : null;
                  const below = !m.won && m.bidRate != null && m.floorRate != null && m.bidRate < m.floorRate;
                  return (
                    <TableRow key={i}>
                      <TableCell className='tabular-nums'>{m.openedAt}</TableCell>
                      <TableCell className='text-right tabular-nums'>{m.floorRate}</TableCell>
                      <TableCell className='text-right tabular-nums'>{won(m.basePrice)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{m.bidRate?.toFixed(3)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{m.winRate?.toFixed(3)}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${diff != null && Math.abs(diff) < 0.1 ? 'text-green-600' : diff != null && diff > 0 ? 'text-amber-600' : 'text-destructive'}`}>
                        {diff != null ? (diff > 0 ? `+${diff}` : diff) : '-'}
                      </TableCell>
                      <TableCell>
                        {m.won ? <Badge className='bg-green-600'>낙찰</Badge>
                          : below ? <Badge variant='destructive'>미달</Badge>
                          : <Badge variant='secondary'>밀림</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
