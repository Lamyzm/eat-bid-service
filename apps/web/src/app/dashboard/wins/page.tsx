'use client';
/**
 * 낙찰 — 개찰 속보판 + 월별 보드 (무료 구역)
 * 스펙 v3: "남들 뭐 땄나 · 요즘 얼마에 끝나나"에 답하는 구경 구역.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRegion } from '@/lib/region';
import { RegionStatus } from '@/components/region-status';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { useWorkspace } from '@/lib/workspace';
import { useTrack } from '@/lib/track';
import { won, eok, CATS } from '@/lib/format';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Win = {
  bidId: string; schoolId: string; schoolName: string; sigungu: string | null;
  category: string | null; openedAt: string; basePrice: number | null; floorRate: number | null;
  winRate: number | null; winnerName: string | null; nValid: number; nBids: number | null; gap12: number | null;
};
type MonthCell = { month: string; category: string; n: number; medWin: number | null; sumBase: number };


export default function WinsPage() {
  useTrack('wins');
  const [days, setDays] = useState(30);
  const [cat, setCat] = useState<string | null>(null);
  const [rows, setRows] = useState<Win[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const { bizNos } = useWorkspace();
  const [myBidIds, setMyBidIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (bizNos.length === 0) return;
    fetch(`/api/firms/bids?bizNos=${bizNos.join(',')}&limit=2000`).then(r => r.json())
      .then(d => {
        const xs = Array.isArray(d) ? d : (d.rows ?? []);
        setMyBidIds(new Set(xs.map((x: any) => x.bidId)));
      }).catch(() => {});
  }, [bizNos]);
  const [monthly, setMonthly] = useState<MonthCell[]>([]);
  const { viewRegions, isBrowsing, view, homes, ready } = useRegion();
  const regionKey = viewRegions?.join(',') ?? '';

  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ days: String(days), withTotal: '1' });
    if (cat) q.set('category', cat);
    if (regionKey) q.set('sigungu', regionKey);
    fetch(`/api/wins/recent?${q}`).then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : (d.rows ?? []));
      setTotal(Array.isArray(d) ? null : (d.total ?? null));
    });
  }, [days, cat, regionKey, ready]);
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ months: '12' });
    if (regionKey) q.set('sigungu', regionKey);
    fetch(`/api/wins/monthly?${q}`).then(r => r.json()).then(setMonthly);
  }, [regionKey, ready]);

  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const totalBase = rows.reduce((s, r) => s + (r.basePrice ?? 0), 0);
  const gaps = rows.filter(r => r.gap12 != null).map(r => r.gap12!).sort((a, b) => a - b);
  const gapMed = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  // 월별 보드 매트릭스
  const board = useMemo(() => {
    const months = [...new Set(monthly.map(m => m.month))].sort().reverse();
    const cats = CATS.filter(c => monthly.some(m => m.category === c));
    const cell = new Map(monthly.map(m => [`${m.month}|${m.category}`, m]));
    return { months, cats, cell };
  }, [monthly]);

  return (
    <div className='flex flex-1 flex-col space-y-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>낙찰</h1>
          {/* 히어로 숫자 — 화면당 1개: 최근 N일 개찰 건수 (DESIGN C표) */}
          <div className='mt-0.5 text-3xl font-bold tabular-nums'>
            {(total ?? rows.length).toLocaleString()}<span className='text-muted-foreground ml-1 text-base font-normal'>건 · 최근 {days}일 개찰</span>
          </div>
          <p className='text-muted-foreground text-sm tabular-nums'>
            {total != null && total > rows.length && `${rows.length}건 표시 · `}기초금액 합계 {eok(totalBase)}원
            {gapMed != null && <> · 1–2등 차이 중앙값 <b className='text-foreground'>{gapMed.toFixed(3)}</b></>}
            {total != null && total > rows.length && <span className='text-muted-foreground'> (합계·중앙값은 표시 {rows.length}건 기준)</span>}
          </p>
          <div className='mt-1'><RegionStatus /></div>
        </div>
        {isBrowsing && (
          homes.length === 0 ? (
            <div className='rounded border px-3 py-1.5 text-sm'>
              <b>{view} 지역을 보는 중입니다</b> · 내 자격 지역을 설정하면 자격 여부를 함께 표시합니다{' '}
              <Link href='/dashboard/my' className='text-primary font-semibold hover:underline'>설정 →</Link>
            </div>
          ) : (
            <div className='rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm'>
              <b>{view} 구경 중</b> — 내 자격 지역({homes.join(' · ')})이 아닙니다. 참가 자격은 사무소 소재지 기준입니다.
            </div>
          )
        )}
      </div>

      {/* 월별 보드 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>월별 보드</CardTitle>
          <CardDescription>월×품목 · 칸 = 건수 · 낙찰률 중앙값 · 기초금액 합계</CardDescription>
        </CardHeader>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>월</TableHead>
                  {board.cats.map(c => <TableHead key={c} className='text-right'>{c}</TableHead>)}
                  <TableHead className='text-right'>합계</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.months.map(m => {
                  const rowCells = board.cats.map(c => board.cell.get(`${m}|${c}`));
                  const rowN = rowCells.reduce((s, x) => s + (x?.n ?? 0), 0);
                  const rowBase = rowCells.reduce((s, x) => s + (x?.sumBase ?? 0), 0);
                  return (
                    <TableRow key={m}>
                      <TableCell className='font-medium tabular-nums'>{m}</TableCell>
                      {rowCells.map((x, i) => (
                        <TableCell key={i} className='text-right tabular-nums'>
                          {x ? (<>
                            <div className='font-semibold'>{x.n}건{x.medWin != null && <span className='text-muted-foreground font-normal'> · {x.medWin.toFixed(2)}</span>}</div>
                            <div className='text-muted-foreground text-xs'>{eok(x.sumBase)}원</div>
                          </>) : <span className='text-muted-foreground'>—</span>}
                        </TableCell>
                      ))}
                      <TableCell className='text-right font-semibold tabular-nums'>
                        {rowN}건<div className='text-muted-foreground text-xs font-normal'>{eok(rowBase)}원</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 개찰 속보판 */}
      <Card>
        <CardHeader className='pb-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle className='text-base'>개찰 속보</CardTitle>
            <div className='flex flex-wrap gap-1.5'>
              {[14, 30, 60, 120].map(d => (
                <Button key={d} size='sm' variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>{d}일</Button>
              ))}
              <span className='mx-1' />
              <Button size='sm' variant={cat === null ? 'default' : 'outline'} onClick={() => setCat(null)}>전체</Button>
              {CATS.slice(0, 5).map(c => (
                <Button key={c} size='sm' variant={cat === c ? 'default' : 'outline'} onClick={() => setCat(c)}>{c}</Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto', maxHeight: 640, overflowY: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>개찰일</TableHead><TableHead>학교</TableHead><TableHead>품목</TableHead>
                  <TableHead className='text-right'>기초금액</TableHead>
                  <TableHead className='text-right'>하한</TableHead>
                  <TableHead className='text-right'>낙찰률</TableHead>
                  <TableHead>낙찰 업체</TableHead>
                  <TableHead className='text-right'>참여</TableHead>
                  <TableHead className='text-right'>1–2등 차</TableHead>
                  {bizNos.length > 0 && <TableHead className='text-center'>내 참여</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.bidId} className={r.openedAt >= yesterday ? 'bg-primary/5' : ''}>
                    <TableCell className='tabular-nums'>
                      {r.openedAt}{r.openedAt >= yesterday && <Badge className='ml-1.5' variant='secondary'>NEW</Badge>}
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/schools/${encodeURIComponent(r.schoolId)}`}
                        className='font-medium hover:underline'>{r.schoolName}</Link>
                    </TableCell>
                    <TableCell>{r.category ?? '-'}</TableCell>
                    <TableCell className='text-right tabular-nums'>{won(r.basePrice)}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.floorRate ?? '-'}</TableCell>
                    <TableCell className='text-right font-mono font-semibold tabular-nums'>{r.winRate?.toFixed(3) ?? '-'}</TableCell>
                    <TableCell className='max-w-[180px] truncate'>{r.winnerName ?? '-'}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.nBids ?? r.nValid}곳</TableCell>
                    <TableCell className='text-right font-mono tabular-nums'>
                      {r.gap12 != null ? (
                        <span className={r.gap12 <= 0.01 ? 'text-destructive font-semibold' : ''}>{r.gap12.toFixed(3)}</span>
                      ) : '-'}
                    </TableCell>
                    {bizNos.length > 0 && (
                      <TableCell className='text-center'>
                        {myBidIds.has(r.bidId) && <span className='text-primary'>●</span>}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className='py-6'>
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>이 조건의 개찰 결과가 없습니다</EmptyTitle>
                        <EmptyDescription>기간을 늘리거나 품목·지역을 바꿔보세요.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className='text-muted-foreground text-xs'>
        1–2등 차 = 낙찰률과 2위 투찰률의 간격. 0.010 이하는 빨간색. 지역은 우측 상단 스위처로 바꿉니다 (적재 지역 확장 중).
      </p>
    </div>
  );
}
