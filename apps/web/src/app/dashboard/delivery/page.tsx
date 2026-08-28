'use client';
/**
 * 납품 — 낙찰 이후 구간 (TEAM-KICKOFF §C: 매일 열 이유)
 * 월 정산 표 + 납품 달력 + 계약 확인서 인쇄. 데이터: /api/firms/bids won=true + 납품기간.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useSession } from '@/lib/session';
import { useTrack } from '@/lib/track';
import { won } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Row = {
  bidId: string; bizNo: string; openedAt: string | null; schoolName: string | null;
  sigungu: string | null; category: string | null; basePrice: number | null;
  bidRate: number | null; won: boolean; dlvryStart: string | null; dlvryEnd: string | null;
};

const STATUS = { 진행: '납품중', 예정: '예정', 종료: '종료' } as const;

function ym(d: Date) { return d.toISOString().slice(0, 7); }

/** 기간과 월의 겹치는 급식일수(주말 제외 근사) */
function mealDays(start: string, end: string, month: string): number {
  const mStart = new Date(`${month}-01T00:00:00`);
  const mEnd = new Date(mStart); mEnd.setMonth(mEnd.getMonth() + 1);
  const s = new Date(Math.max(+new Date(start), +mStart));
  const e = new Date(Math.min(+new Date(end) + 864e5, +mEnd));
  let n = 0;
  for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(0, n);
}

export default function DeliveryPage() {
  useTrack('delivery');
  const { bizNos, ready } = useWorkspace();
  const { guest, googleEnabled } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [month, setMonth] = useState(() => ym(new Date()));
  const [printRow, setPrintRow] = useState<Row | null>(null);

  useEffect(() => {
    if (bizNos.length === 0) return;
    fetch(`/api/firms/bids?bizNos=${bizNos.join(',')}&limit=2000`).then(r => r.json())
      .then(d => {
        const xs: Row[] = Array.isArray(d) ? d : (d.rows ?? []);
        setRows(xs.filter(r => r.won));
      });
  }, [bizNos]);

  // 이 달과 기간이 겹치는 계약
  const contracts = useMemo(() => rows
    .filter(r => r.dlvryStart && r.dlvryEnd &&
      r.dlvryStart.slice(0, 7) <= month && r.dlvryEnd.slice(0, 7) >= month)
    .map(r => ({
      ...r,
      amount: r.basePrice != null && r.bidRate != null ? Math.round(r.basePrice * r.bidRate / 100) : null,
      days: mealDays(r.dlvryStart!, r.dlvryEnd!, month),
      status: (() => {
        const today = new Date().toISOString().slice(0, 10);
        if (r.dlvryEnd! < today) return STATUS.종료;
        if (r.dlvryStart! > today) return STATUS.예정;
        return STATUS.진행;
      })(),
    }))
    .sort((a, b) => (a.dlvryStart ?? '').localeCompare(b.dlvryStart ?? '')), [rows, month]);

  const sum = contracts.reduce((s, c) => s + (c.amount ?? 0), 0);
  const monthLabel = `${Number(month.slice(5, 7))}월`;

  // 달력: 날짜별 동시 납품 건수
  const calendar = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const counts: number[] = Array(daysInMonth + 1).fill(0);
    for (const c of contracts) {
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${month}-${String(d).padStart(2, '0')}`;
        if (c.dlvryStart! <= iso && iso <= c.dlvryEnd!) counts[d]++;
      }
    }
    return { firstDay: first.getDay(), daysInMonth, counts };
  }, [contracts, month]);

  const shiftMonth = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() + delta);
    setMonth(ym(d));
  };

  const csv = () => {
    const head = '학교,시군구,품목,납품시작,납품종료,계약액,급식일수,상태';
    const lines = contracts.map(c =>
      [c.schoolName, c.sigungu, c.category, c.dlvryStart, c.dlvryEnd, c.amount ?? '', c.days, c.status].join(','));
    const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `납품_${month}.csv`;
    a.click();
  };

  const doPrint = (c: Row) => {
    setPrintRow(c);
    setTimeout(() => { window.print(); setPrintRow(null); }, 60);
  };

  if (ready && bizNos.length === 0) return (
    <div className='p-8'>
      <h1 className='mb-2 text-2xl font-semibold'>납품</h1>
      <p>사업자번호를 등록하면 낙찰 계약의 납품 일정이 정리됩니다.{' '}
        <Link href='/welcome' className='text-primary font-semibold hover:underline'>사업자 등록 →</Link></p>
    </div>
  );

  return (
    <>
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6 print:hidden'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>납품</h1>
          <p className='text-muted-foreground text-sm'>접속할 때마다 최신 낙찰분이 반영됩니다.</p>
        </div>
        <div className='flex items-center gap-1.5'>
          <Button size='sm' variant='outline' onClick={() => shiftMonth(-1)}>←</Button>
          <span className='w-20 text-center font-medium tabular-nums'>{month}</span>
          <Button size='sm' variant='outline' onClick={() => shiftMonth(1)}>→</Button>
          <span className='mx-1' />
          <Button size='sm' variant='outline' onClick={csv}>CSV 저장</Button>
        </div>
      </div>

      {guest && googleEnabled && (
        <p className='text-muted-foreground text-sm'>로그인하면 다른 PC에서도 이어서 봅니다.</p>
      )}

      {/* 히어로 */}
      <Card className='border-primary'>
        <CardContent className='py-4'>
          <div className='text-muted-foreground text-xs'>{monthLabel} 납품 계약</div>
          <div className='text-3xl font-bold tabular-nums'>
            {contracts.length}건 · 합계 {won(sum)}원
          </div>
        </CardContent>
      </Card>

      <div className='grid gap-4 xl:grid-cols-[1fr_340px]'>
        {/* 월 정산 표 */}
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>{monthLabel} 정산 표</CardTitle>
            <CardDescription>계약액 = 기초금액 × 내 투찰률 (투찰가 기준 — 실제 정산과 다를 수 있습니다).</CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>학교</TableHead><TableHead>품목</TableHead>
                  <TableHead>납품기간</TableHead>
                  <TableHead className='text-right'>계약액</TableHead>
                  <TableHead className='text-right'>급식일수</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead />
                </TableRow></TableHeader>
                <TableBody>
                  {contracts.map(c => (
                    <TableRow key={`${c.bidId}|${c.bizNo}`}>
                      <TableCell>
                        {c.sigungu && c.schoolName ? (
                          <Link href={`/dashboard/analysis/${encodeURIComponent(`${c.sigungu}|${c.schoolName}`)}`}
                            className='font-medium hover:underline'>{c.schoolName}</Link>
                        ) : (c.schoolName ?? '-')}
                      </TableCell>
                      <TableCell><Badge variant='secondary'>{c.category ?? '-'}</Badge></TableCell>
                      <TableCell className='text-sm tabular-nums'>{c.dlvryStart} ~ {c.dlvryEnd}</TableCell>
                      <TableCell className='text-right font-mono tabular-nums'>{won(c.amount)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{c.days}일</TableCell>
                      <TableCell>
                        {c.status === '납품중' && <Badge className='bg-primary'>납품중</Badge>}
                        {c.status === '예정' && <Badge variant='secondary'>예정</Badge>}
                        {c.status === '종료' && <Badge variant='outline'>종료</Badge>}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button size='sm' variant='ghost' className='h-7 px-2 text-xs'
                          onClick={() => doPrint(c)}>확인서 인쇄</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {contracts.length > 0 && (
                    <TableRow className='bg-muted/50 font-semibold'>
                      <TableCell colSpan={3}>합계 {contracts.length}건</TableCell>
                      <TableCell className='text-right font-mono tabular-nums'>{won(sum)}</TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  )}
                  {contracts.length === 0 && (
                    <TableRow><TableCell colSpan={7} className='text-muted-foreground py-8 text-center'>
                      {monthLabel}에 걸친 낙찰 계약이 없습니다.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 납품 달력 */}
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>납품 달력</CardTitle>
            <CardDescription>칸 숫자 = 그날 동시 납품 건수. 3건 이상은 노란색.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-7 gap-1 text-center text-xs'>
              {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                <div key={d} className='text-muted-foreground py-1'>{d}</div>
              ))}
              {Array.from({ length: calendar.firstDay }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: calendar.daysInMonth }, (_, i) => i + 1).map(d => {
                const n = calendar.counts[d];
                return (
                  <div key={d}
                    className={`rounded border py-1.5 tabular-nums ${
                      n >= 3 ? 'border-amber-500 bg-amber-500/15 font-semibold'
                        : n > 0 ? 'bg-primary/10' : 'text-muted-foreground'}`}>
                    <div>{d}</div>
                    {n > 0 && <div className='text-[10px]'>{n}건</div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    {/* 계약 확인서 — 인쇄 시에만 */}
    {printRow && (
      <div className='hidden print:block' style={{ padding: '40px', fontFamily: 'Pretendard, sans-serif' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>납품 계약 확인서</h1>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <tbody>
            {[
              ['학교', `${printRow.sigungu ?? ''} ${printRow.schoolName ?? ''}`],
              ['품목', printRow.category ?? '-'],
              ['납품 기간', `${printRow.dlvryStart} ~ ${printRow.dlvryEnd}`],
              ['계약액(투찰가 기준)', `${won(printRow.basePrice != null && printRow.bidRate != null ? Math.round(printRow.basePrice * printRow.bidRate / 100) : null)}원`],
              ['공고번호', printRow.bidId],
              ['낙찰 사업자', printRow.bizNo],
            ].map(([k, v]) => (
              <tr key={k as string}>
                <td style={{ border: '1px solid #999', padding: '10px 12px', width: 160, fontWeight: 600, background: '#f4f4f4' }}>{k}</td>
                <td style={{ border: '1px solid #999', padding: '10px 12px' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
          계약액은 투찰가 기준이며 실제 정산과 다를 수 있습니다. 출력일 {new Date().toISOString().slice(0, 10)}
        </p>
      </div>
    )}
    </>
  );
}
