'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SchoolSummary, FloorStat } from '@eatbid/shared';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

function primaryBand(s: SchoolSummary): { floor: string; stat: FloorStat } | null {
  for (const f of ['90.0', '88.0', '84.245']) {
    const st = (s.byFloor as Record<string, FloorStat>)[f];
    if (st) return { floor: String(parseInt(f)), stat: st };
  }
  return null;
}

export default function SchoolsPage() {
  const [rows, setRows] = useState<SchoolSummary[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/schools?limit=200').then(r => r.json()).then(setRows);
  }, []);

  const filtered = useMemo(
    () => rows.filter(s => !q || s.name.includes(q)),
    [rows, q]
  );

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>학교 찾기</h1>
        <p className='text-muted-foreground text-sm'>
          학교마다 과거에 얼마에 낙찰됐는지 정리한 기록입니다. 줄을 누르면 상세로.
        </p>
      </div>
      <Input value={q} onChange={e => setQ(e.target.value)}
        placeholder='🔍 학교 이름 검색 (예: 장유, 진례, 외고…)' className='max-w-md' />
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학교</TableHead>
                <TableHead className='text-right'>공고 수</TableHead>
                <TableHead className='text-right'>업체 수</TableHead>
                <TableHead>잘 나온 구간</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => {
                const b = primaryBand(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/dashboard/schools/${encodeURIComponent(s.id)}`}
                        className='font-medium hover:underline'>{s.name}</Link>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>{s.nAuctions}</TableCell>
                    <TableCell className='text-right tabular-nums'>{s.medField}곳</TableCell>
                    <TableCell className='tabular-nums'>
                      {b?.stat.dense
                        ? <><Badge variant='secondary' className='mr-1.5'>하한{b.floor}</Badge>
                            {b.stat.dense.lo.toFixed(2)}~{b.stat.dense.hi.toFixed(2)}</>
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className='text-muted-foreground py-8 text-center'>
                  '{q}' 검색 결과가 없습니다.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
