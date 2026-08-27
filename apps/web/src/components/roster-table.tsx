'use client';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

export type RosterRow = {
  bizNo: string; name: string; partN: number; winN: number;
  winRates: number[]; medRate: number | null;
};

/** 단골 참여 업체 — 사실 전부, 해석 라벨 없음 (②③⑥ 공용) */
export function RosterTable({ rows, limit = 12 }: { rows: RosterRow[]; limit?: number }) {
  return (
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
          {rows.slice(0, limit).map(r => (
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
  );
}
