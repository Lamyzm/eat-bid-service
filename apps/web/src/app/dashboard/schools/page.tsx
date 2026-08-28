'use client';
/**
 * 학교 찾기 — 비드큐 리스트 문법: 필터(품목·참여수 구간·검색) + 정렬 + 주요 값 + CSV
 * 행 클릭 = 분석판. 발주 예보 임박 학교 상단 제안.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SchoolSummary, FloorStat } from '@eatbid/shared';
import { useRegion } from '@/lib/region';
import { RegionStatus } from '@/components/region-status';
import { useTrack } from '@/lib/track';
import { won, CATS } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia
} from '@/components/ui/empty';
import { IconSchool } from '@tabler/icons-react';
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
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => { try { setFilterOpen(localStorage.getItem('eatbid.schoolFilter') === '1'); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('eatbid.schoolFilter', filterOpen ? '1' : '0'); } catch {} }, [filterOpen]);
  const { viewRegions, isBrowsing, view, homes, ready } = useRegion();

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
  // 발주 예보 — ready 가드 + Abort + 스테일 가드 (U18)
  useEffect(() => {
    if (!ready) return;
    const key = viewRegions?.join(',') ?? '';
    const ac = new AbortController();
    fetch(`/api/schools/forecast${key ? `?sigungu=${key}` : ''}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (key === (viewRegions?.join(',') ?? '')) setForecast(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => ac.abort();
  }, [viewRegions?.join(','), ready]);

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
          {/* 히어로 숫자 — 화면당 1개: 표시 학교 수 (DESIGN C표) */}
          <div className='mt-0.5 text-3xl font-bold tabular-nums'>
            {filtered.length.toLocaleString()}<span className='text-muted-foreground ml-1 text-base font-normal'>개 학교</span>
          </div>
          <p className='text-muted-foreground text-sm tabular-nums'>{!q.trim() && rows.length >= 500 ? '상위 500 표시 · 검색으로 좁혀집니다 · ' : ''}행 클릭 = 분석판</p>
          <div className='mt-1'><RegionStatus /></div>
        </div>
        <div className='flex min-w-0 flex-wrap items-center justify-end gap-2'>
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

      {/* 필터 — 버튼 하나로 접고 적용된 것만 칩 (C) */}
      <div className='flex flex-wrap items-center gap-1.5'>
        <Input placeholder='학교 이름 검색' value={q} onChange={e => setQ(e.target.value)} className='w-52' />
        <Button size='sm' variant={filterOpen ? 'default' : 'outline'} onClick={() => setFilterOpen(v => !v)}>
          필터{(cat ? 1 : 0) + (fieldMax ? 1 : 0) > 0 ? ` (${(cat ? 1 : 0) + (fieldMax ? 1 : 0)})` : ''}
        </Button>
        {cat && <Badge variant='secondary' className='cursor-pointer' onClick={() => setCat(null)}>{cat} ✕</Badge>}
        {fieldMax && <Badge variant='secondary' className='cursor-pointer' onClick={() => setFieldMax(null)}>참여 {fieldMax}곳 이하 ✕</Badge>}
      </div>
      {filterOpen && (
        <div className='flex flex-wrap items-center gap-1.5 rounded border p-2'>
          <span className='text-muted-foreground text-xs'>품목</span>
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
        </div>
      )}

      <Card>
        <CardContent className='p-0'>
          {filtered.length === 0 ? (
            <Empty className='py-14'>
              <EmptyHeader>
                <EmptyMedia variant='icon'><IconSchool /></EmptyMedia>
                <EmptyTitle>{rows.length === 0 && q.trim() ? '검색 결과가 없습니다' : '이 지역에 표시할 학교가 없습니다'}</EmptyTitle>
                <EmptyDescription>
                  우측 상단 지역 스위처로 다른 지역을 볼 수 있습니다. 검색어·필터를 바꾸면 결과가 달라집니다.
                </EmptyDescription>
              </EmptyHeader>
              {(q.trim() || cat || fieldMax) && (
                <EmptyContent>
                  <Button size='sm' variant='outline'
                    onClick={() => { setQ(''); setCat(null); setFieldMax(null); }}>검색·필터 지우기</Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead>학교</TableHead><TableHead>품목</TableHead>
                <TableHead className='cursor-pointer text-right select-none' onClick={() => setSort('n')}>
                  공고{sort === 'n' ? ' ▼' : ''}
                </TableHead>
                <TableHead className='cursor-pointer text-right select-none' onClick={() => setSort('field')}>
                  보통 참여{sort === 'field' ? ' ▲' : ''}
                </TableHead>
                <TableHead>잘 나온 구간</TableHead>
                <TableHead>자주 걸린 값</TableHead>
                <TableHead className='cursor-pointer text-right select-none' onClick={() => setSort('base')}>
                  기초금액(중앙){sort === 'base' ? ' ▼' : ''}
                </TableHead>
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
          )}
        </CardContent>
      </Card>
      {filtered.length > 0 && (
        <p className='text-muted-foreground text-xs'>● = 보통 10곳 이하 참여. 잘 나온 구간·자주 걸린 값은 최다 하한 기준.</p>
      )}
    </div>
  );
}
