'use client';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import type { FirmRecord, FirmTimelinePoint } from '@eatbid/shared';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

const eok = (n: number | null) =>
  n == null ? '-' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

export default function RecordPage() {
  const { bizNos, ready } = useWorkspace();
  const [rec, setRec] = useState<FirmRecord | null>(null);
  const [tl, setTl] = useState<FirmTimelinePoint[]>([]);

  useEffect(() => {
    if (!ready || bizNos.length === 0) return;
    const q = bizNos.join(',');
    fetch(`/api/firms/record?bizNos=${q}`).then(r => r.json()).then(setRec);
    fetch(`/api/firms/timeline?bizNos=${q}`).then(r => r.json()).then(setTl);
  }, [ready, bizNos]);

  if (ready && bizNos.length === 0) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center'>
        <h1 className='text-xl font-semibold'>사업자번호를 먼저 등록하세요</h1>
        <p className='text-muted-foreground text-sm'>번호만 넣으면 지금까지의 낙찰 추이가 바로 나옵니다.</p>
        <Button onClick={() => { window.location.href = '/dashboard/my'; }}>사업자 등록하러 가기</Button>
      </div>
    );
  }

  const winRate = rec && rec.totalBids ? ((100 * rec.totalWins) / rec.totalBids).toFixed(1) : '-';

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>내 성적</h1>
        <p className='text-muted-foreground text-sm'>
          사업자 {bizNos.length}곳 합산 · 공개 입찰 기록 기준.
        </p>
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        {[
          ['총 투찰', rec?.totalBids?.toLocaleString() ?? '…'],
          ['낙찰', `${rec?.totalWins ?? '…'}건 (${winRate}%)`],
          ['밀림', `${rec?.pushedOut ?? '…'}번`, '더 낮게 쓴 업체에'],
          ['하한 미달', `${rec?.belowFloor ?? '…'}번`, '무효 처리'],
          ['활동 지역', `${rec?.regions?.length ?? '…'}곳`],
        ].map(([k, v, sub]) => (
          <Card key={k as string}>
            <CardHeader className='pb-1'><CardDescription>{k}</CardDescription></CardHeader>
            <CardContent>
              <div className='text-xl font-semibold tabular-nums'>{v}</div>
              {sub && <div className='text-muted-foreground text-xs'>{sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>월별 투찰·낙찰 추이</CardTitle>
          <CardDescription>막대 = 투찰, 선 = 낙찰</CardDescription>
        </CardHeader>
        <CardContent className='h-72'>
          <ResponsiveContainer width='100%' height='100%'>
            <ComposedChart data={tl}>
              <CartesianGrid strokeDasharray='3 3' opacity={0.3} />
              <XAxis dataKey='ym' fontSize={11} tickFormatter={v => v.slice(2)} />
              <YAxis yAxisId='l' fontSize={11} />
              <YAxis yAxisId='r' orientation='right' fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar yAxisId='l' dataKey='bids' name='투찰' fill='var(--primary)' opacity={0.35} />
              <Line yAxisId='r' dataKey='wins' name='낙찰' stroke='var(--primary)' strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>최근 낙찰 {rec?.recentWins?.length ?? 0}건</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead><TableHead>학교</TableHead>
                <TableHead>지역</TableHead>
                <TableHead className='text-right'>기초가</TableHead>
                <TableHead className='text-right'>내 투찰률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rec?.recentWins?.map((w, i) => (
                <TableRow key={i}>
                  <TableCell className='tabular-nums'>{w.openedAt ?? '-'}</TableCell>
                  <TableCell>{w.schoolName ?? '-'}</TableCell>
                  <TableCell>{w.sigungu ?? '-'}</TableCell>
                  <TableCell className='text-right tabular-nums'>{eok(w.basePrice)}</TableCell>
                  <TableCell className='text-right tabular-nums'>{w.bidRate?.toFixed(3) ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
