'use client';
/**
 * 학교 찾기 — 비드큐 리스트 문법: 필터(품목·참여수 구간·검색) + 정렬 + 주요 값 + CSV
 * 행 클릭 = 분석판. 발주 예보 임박 학교 상단 제안.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SchoolSummary, FloorStat } from '@eatbid/shared';
import { useRegion } from '@/lib/region';
import { useTrack } from '@/lib/track';
import { won, CATS } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Forecast = { schoolId: string; schoolName: string; medGapDays: number; lastOpened: string; expected: string; dueInDays: number; lastWinRate: number | null };

function primaryBand(s: SchoolSummary): { floor: string; stat: FloorStat } | null {
  const bf = s.byFloor as Record<string, FloorStat>;
  const keys = Object.keys(bf).sort((a, b) => (bf[b]?.n ?? 0) - (bf[a]?.n ?? 0));
  const k = keys[0];
  return k ? { floor: String(parseFloat(k)), stat: bf[k] } : null;
}
type SortKey = 'n' | 'field' | 'base';

export default function SchoolsPage() {
  useTrack('schools');
  const [rows, setRows] = useState<SchoolSummary[]>([]);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [fieldMax, setFieldMax] = useState<number | null>(null); // 보통 참여 N곳 이하
  const [sort, setSort] = useState<SortKey>('n');
  const { viewRegions, isBrowsing, view, homes } = useRegion();

  // 서버 검색 — 300ms debounce. 빈 검색은 상위 500
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = q.trim()
        ? `q=${encodeURIComponent(q.trim())}&limit=100`
        : 'limit=500';
      fetch(`/api/schools?${qs}`).then(r => r.json()).then(x => setRows(Array.isArray(x) ? x : []));
    }, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const q = viewRegions?.length ? `?sigungu=${viewRegions.join(',')}` : '';
    fetch(`/api/schools/forecast${q}`).then(r => r.json()).then(setForecast).catch(() => {});
  }, [viewRegions?.join(',')]);

  const dueSoon = useMemo(() => forecast.filter(f => f.dueInDays <= 7).slice(0, 6), [forecast]);
  const dueById = useMemo(() => new Map(forecast.map(f => [f.schoolId, f])), [forecast]);

  const filtered = useMemo(() => rows
    .filter(s => (viewRegions == null || viewRegions.includes(s.sigungu ?? '')) &&
      (cat == null || s.category === cat) &&
      (fieldMax == null || (s.medField ?? 999) <= fieldMax))
    .sort((a, b) => sort === 'n' ? b.nAuctions - a.nAuctions
      : sort === 'field' ? (a.medField ?? 999) - (b.medField ?? 999)
      : (b.medBase ?? 0) - (a.medBase ?? 0)),
    [rows, q, cat, fieldMax, sort, viewRegions]);

  const csv = () => {
    const head = '학교,시군구,품목,공고수,보통참여,잘나온구간,기초금액중앙값';
    const lines = filtered.map(s => {
      const b = primaryBand(s);
      const band = b?.stat.dense ? `${b.stat.dense.lo.toFixed(2)}~${b.stat.dense.hi.toFixed(2)}` : '';
      return [s.name, s.sigungu, s.category, s.nAuctions, s.medField ?? '', band, s.medBase ?? ''].join(',');
    });
    const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `학교목록_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>학교 찾기</h1>
          <p className='text-muted-foreground text-sm tabular-nums'>{filtered.length}개 학교{!q.trim() && rows.length >= 500 ? ' (상위 500 표시 — 검색으로 좁히세요)' : ''} · 행 클릭 = 분석판</p>
        </div>
        <div className='flex items-center gap-2'>
          {isBrowsing && (homes.length === 0
            ? <span className='rounded border px-2 py-1 text-xs'><b>{view} 보는 중</b> · <Link href='/dashboard/my' className='text-primary hover:underline'>자격 지역 설정</Link></span>
            : <span className='rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs'><b>{view} 구경 중</b> · 내 자격 지역 아님</span>)}
          <Button size='sm' variant='outline' onClick={csv}>CSV 저장</Button>
        </div>
      </div>

      {/* 발주 임박 제안 */}
      {dueSoon.length > 0 && (
        <Card>
          <CardContent className='flex flex-wrap items-center gap-2 py-3 text-sm'>
            <b>발주 예정</b>
            {dueSoon.map(f => (
              <Link key={f.schoolId} href={`/dashboard/analysis/${encodeURIComponent(f.schoolId)}`}
                className='hover:border-primary rounded border px-2 py-1 tabular-nums'>
                {f.schoolName} <span className='text-muted-foreground'>
                  {f.dueInDays <= 0 ? '도래' : `D-${f.dueInDays}`}
                  {f.lastWinRate != null && ` · 지난 낙찰 ${f.lastWinRate.toFixed(2)}`}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 필터 */}
      <div className='flex flex-wrap items-center gap-1.5'>
        <Input placeholder='학교 이름 검색' value={q} onChange={e => setQ(e.target.value)} className='w-52' />
        <span className='mx-1' />
        <Button size='sm' variant={cat === null ? 'default' : 'outline'} onClick={() => setCat(null)}>전체</Button>
        {CATS.map(c => (
          <Button key={c} size='sm' variant={cat === c ? 'default' : 'outline'} onClick={() => setCat(c)}>{c}</Button>
        ))}
        <span className='mx-1' />
        <span className='text-muted-foreground text-xs'>보통 참여</span>
        {[10, 30, 50].map(n => (
          <Button key={n} size='sm' variant={fieldMax === n ? 'default' : 'outline'}
            onClick={() => setFieldMax(fieldMax === n ? null : n)}>{n}곳 이하</Button>
        ))}
        <span className='mx-1' />
        <span className='text-muted-foreground text-xs'>정렬</span>
        {([['n', '공고수'], ['field', '참여 적은순'], ['base', '금액 큰순']] as const).map(([k, label]) => (
          <Button key={k} size='sm' variant={sort === k ? 'default' : 'outline'} onClick={() => setSort(k)}>{label}</Button>
        ))}
      </div>

      <Card>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead>학교</TableHead><TableHead>품목</TableHead>
                <TableHead className='text-right'>공고</TableHead>
                <TableHead className='text-right'>보통 참여</TableHead>
                <TableHead>잘 나온 구간</TableHead>
                <TableHead>자주 걸린 값</TableHead>
                <TableHead className='text-right'>기초금액(중앙)</TableHead>
                <TableHead>다음 발주</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(s => {
                  const b = primaryBand(s);
                  const f = dueById.get(s.id);
                  const thin = (s.medField ?? 999) <= 10;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/dashboard/analysis/${encodeURIComponent(s.id)}`}
                          className='font-medium hover:underline'>{s.name}</Link>
                        <span className='text-muted-foreground ml-2 text-xs'>{s.sigungu}</span>
                      </TableCell>
                      <TableCell><Badge variant='secondary'>{s.category}</Badge></TableCell>
                      <TableCell className='text-right tabular-nums'>{s.nAuctions}건</TableCell>
                      <TableCell className={`text-right tabular-nums ${thin ? 'text-primary font-bold' : ''}`}>
                        {s.medField ?? '-'}곳{thin && ' ●'}
                      </TableCell>
                      <TableCell className='font-mono text-sm tabular-nums'>
                        {b?.stat.dense ? `${b.stat.dense.lo.toFixed(2)}~${b.stat.dense.hi.toFixed(2)}` : '—'}
                        {b && <span className='text-muted-foreground ml-1 text-xs'>(하한 {b.floor})</span>}
                      </TableCell>
                      <TableCell className='font-mono text-sm tabular-nums'>
                        {(b?.stat.recur ?? []).filter(([, c]) => c >= 2).slice(0, 3)
                          .map(([v, c]) => `${v.toFixed(2)}×${c}`).join(' ') || '—'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>{won(s.medBase)}</TableCell>
                      <TableCell className='text-sm tabular-nums'>
                        {f ? (f.dueInDays <= 0 ? <b className='text-primary'>도래</b> : `D-${f.dueInDays}`) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className='text-muted-foreground text-xs'>● = 보통 10곳 이하 참여. 잘 나온 구간·자주 걸린 값은 최다 하한 기준.</p>
    </div>
  );
}
