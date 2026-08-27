'use client';
/**
 * 퍼널 — 내부 계기판 (nav 비노출, URL 직접 접근만. Clerk 도입 시 가드 예정)
 * /api/events/summary: 최근 30일 화면·일별 열람. 게이트 G1 측정용.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Cell = { day: string; screen: string; n: number; sessions: number };

const SCREEN_ORDER = [
  'today', 'auction', 'analysis', 'wins', 'schools', 'firms', 'record', 'delivery',
  'market', 'welcome', 'basket_add', 'basket_save', 'share_create',
];

export default function FunnelPage() {
  const [rows, setRows] = useState<Cell[]>([]);
  useEffect(() => {
    fetch('/api/events/summary').then(r => r.json())
      .then(x => setRows(Array.isArray(x) ? x : [])).catch(() => {});
  }, []);

  const { days, screens, cell, totals } = useMemo(() => {
    const days = [...new Set(rows.map(r => r.day))].sort().reverse();
    const seen = [...new Set(rows.map(r => r.screen))];
    const screens = [
      ...SCREEN_ORDER.filter(s => seen.includes(s)),
      ...seen.filter(s => !SCREEN_ORDER.includes(s)),
    ];
    const cell = new Map(rows.map(r => [`${r.day}|${r.screen}`, r]));
    const totals = new Map<string, { n: number; sessions: number }>();
    for (const r of rows) {
      const t = totals.get(r.screen) ?? { n: 0, sessions: 0 };
      t.n += r.n; t.sessions = Math.max(t.sessions, r.sessions);
      totals.set(r.screen, t);
    }
    return { days, screens, cell, totals };
  }, [rows]);

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>퍼널</h1>
        <p className='text-muted-foreground text-sm'>내부 계기판 · Clerk 도입 시 가드 예정. 최근 30일 화면·액션 열람 수.</p>
      </div>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>화면별 합계</CardTitle>
          <CardDescription>n = 열람 수 · 괄호 = 일 최대 고유 세션</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          {screens.map(s => {
            const t = totals.get(s)!;
            return (
              <div key={s} className='rounded border px-3 py-2 text-sm tabular-nums'>
                <div className='text-muted-foreground text-xs'>{s}</div>
                <b>{t.n.toLocaleString()}</b> <span className='text-muted-foreground'>({t.sessions})</span>
              </div>
            );
          })}
          {screens.length === 0 && <p className='text-muted-foreground text-sm'>아직 수집된 이벤트가 없습니다.</p>}
        </CardContent>
      </Card>

      {screens.length > 0 && (
        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>일별 매트릭스</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>일</TableHead>
                  {screens.map(s => <TableHead key={s} className='text-right'>{s}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {days.map(d => (
                    <TableRow key={d}>
                      <TableCell className='tabular-nums'>{d}</TableCell>
                      {screens.map(s => {
                        const c = cell.get(`${d}|${s}`);
                        return (
                          <TableCell key={s} className='text-right tabular-nums'>
                            {c ? <>{c.n}<span className='text-muted-foreground text-xs'> ({c.sessions})</span></>
                              : <span className='text-muted-foreground'>—</span>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
