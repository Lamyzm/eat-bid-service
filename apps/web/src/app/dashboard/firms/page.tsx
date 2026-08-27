'use client';
/**
 * 업체 — 경쟁사 분석 (비드큐 '경쟁사 투찰분석' 문법)
 * 검색 → 즐겨찾기(나의 경쟁사) · 최다 낙찰 TOP · 업체 전적 + 최근 낙찰값
 */
import { useEffect, useMemo, useState } from 'react';
import { useTrack } from '@/lib/track';
import { won, eok } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Hit = { bizNo: string; name: string; totalBids: number; totalWins: number };
type Top = { bizNo: string; name: string; wins: number; part: number; winSum: number };
type Rec = {
  totalBids: number; totalWins: number; pushedOut: number; belowFloor: number; regions: string[];
  recentWins: { openedAt: string | null; schoolName: string | null; sigungu: string | null; basePrice: number | null; bidRate: number | null }[];
};

const RIVALS_KEY = 'eatbid.rivals';

export default function FirmsPage() {
  useTrack('firms');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [top, setTop] = useState<Top[]>([]);
  const [sel, setSel] = useState<{ bizNo: string; name: string } | null>(null);
  const [rec, setRec] = useState<Rec | null>(null);
  const [timeline, setTimeline] = useState<{ ym: string; bids: number; wins: number }[]>([]);
  const [rivals, setRivals] = useState<{ bizNo: string; name: string }[]>([]);

  useEffect(() => {
    try { setRivals(JSON.parse(localStorage.getItem(RIVALS_KEY) ?? '[]')); } catch {}
    fetch('/api/firms/top?months=12').then(r => r.json()).then(setTop);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/firms/search?q=${encodeURIComponent(q)}`).then(r => r.json()).then(setHits);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!sel) return;
    fetch(`/api/firms/record?bizNos=${sel.bizNo}`).then(r => r.json()).then(setRec);
    fetch(`/api/firms/timeline?bizNos=${sel.bizNo}`).then(r => r.json()).then(setTimeline);
  }, [sel]);

  const isRival = useMemo(() => sel != null && rivals.some(r => r.bizNo === sel.bizNo), [rivals, sel]);
  const toggleRival = () => {
    if (!sel) return;
    const next = isRival ? rivals.filter(r => r.bizNo !== sel.bizNo) : [...rivals, sel];
    setRivals(next);
    try { localStorage.setItem(RIVALS_KEY, JSON.stringify(next)); } catch {}
  };
  const recentTl = timeline.slice(-12);
  const maxBids = Math.max(1, ...recentTl.map(t => t.bids));

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>업체</h1>
        <p className='text-muted-foreground text-sm'>업체 이름이나 사업자번호로 검색 — 전적·최근 낙찰값·월별 추이.</p>
      </div>

      <div className='grid gap-4 lg:grid-cols-[380px_1fr]'>
        <div className='space-y-4'>
          {/* 검색 */}
          <Card>
            <CardContent className='space-y-2 p-4'>
              <Input placeholder='업체명 또는 사업자번호 (2자 이상)' value={q} onChange={e => setQ(e.target.value)} />
              {hits.length > 0 && (
                <div className='max-h-64 space-y-px overflow-y-auto text-sm'>
                  {hits.map(h => (
                    <button key={h.bizNo} className='hover:bg-accent flex w-full items-center justify-between rounded px-2 py-1.5 text-left'
                      onClick={() => setSel({ bizNo: h.bizNo, name: h.name })}>
                      <span className='truncate pr-2 font-medium'>{h.name}</span>
                      <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>{h.totalBids}회 · {h.totalWins}승</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 나의 경쟁사 */}
          <Card>
            <CardHeader className='pb-2'><CardTitle className='text-base'>나의 경쟁사</CardTitle></CardHeader>
            <CardContent className='p-4 pt-0'>
              {rivals.length === 0
                ? <p className='text-muted-foreground text-sm'>업체를 열고 ★를 누르면 여기 저장됩니다.</p>
                : <div className='flex flex-wrap gap-1.5'>
                    {rivals.map(r => (
                      <Button key={r.bizNo} size='sm' variant={sel?.bizNo === r.bizNo ? 'default' : 'outline'}
                        onClick={() => setSel(r)}>{r.name}</Button>
                    ))}
                  </div>}
            </CardContent>
          </Card>

          {/* TOP */}
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base'>최다 낙찰 TOP</CardTitle>
              <CardDescription>최근 12개월 낙찰 순</CardDescription>
            </CardHeader>
            <CardContent className='p-0'>
              <Table>
                <TableBody>
                  {top.slice(0, 10).map((t, i) => (
                    <TableRow key={t.bizNo} className='cursor-pointer' onClick={() => setSel({ bizNo: t.bizNo, name: t.name })}>
                      <TableCell className='w-8 tabular-nums'>{i + 1}</TableCell>
                      <TableCell className='max-w-[150px] truncate font-medium'>{t.name}</TableCell>
                      <TableCell className='text-right tabular-nums'>{t.wins}승<span className='text-muted-foreground'>/{t.part}회</span></TableCell>
                      <TableCell className='text-right tabular-nums'>{eok(t.winSum)}원</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* 상세 */}
        <Card>
          <CardContent className='p-4'>
            {!sel ? (
              <p className='text-muted-foreground py-8 text-center text-sm'>왼쪽에서 업체를 선택하세요.</p>
            ) : (
              <div className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <div className='text-lg font-semibold'>{sel.name}</div>
                    <div className='text-muted-foreground text-xs tabular-nums'>{sel.bizNo.slice(0, 3)}-{sel.bizNo.slice(3, 5)}-{sel.bizNo.slice(5)}
                      {rec && rec.regions.length > 0 && <> · 활동 지역 {rec.regions.slice(0, 4).join(' · ')}</>}</div>
                  </div>
                  <Button size='sm' variant={isRival ? 'default' : 'outline'} onClick={toggleRival}>
                    {isRival ? '★ 나의 경쟁사' : '☆ 경쟁사로 저장'}
                  </Button>
                </div>
                {rec && (
                  <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
                    {[['참여', rec.totalBids, ''], ['낙찰', rec.totalWins, 'text-primary'],
                      ['밀림', rec.pushedOut, 'text-amber-600'], ['하한미달', rec.belowFloor, 'text-destructive']].map(([l, v, c]) => (
                      <div key={l as string} className='rounded border px-3 py-2'>
                        <div className='text-muted-foreground text-xs'>{l}</div>
                        <div className={`text-lg font-bold tabular-nums ${c}`}>{v as number}회</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* 월별 추이 (최근 12개월) */}
                {recentTl.length > 0 && (
                  <div>
                    <div className='mb-1 text-sm font-medium'>월별 투찰·낙찰</div>
                    <div className='flex items-end gap-1' style={{ height: 90 }}>
                      {recentTl.map(t => (
                        <div key={t.ym} className='flex flex-1 flex-col items-center gap-0.5' title={`${t.ym} · 투찰 ${t.bids} · 낙찰 ${t.wins}`}>
                          <div className='bg-secondary w-full rounded-t' style={{ height: `${t.bids / maxBids * 60}px` }}>
                            <div className='bg-primary w-full rounded-t' style={{ height: `${t.bids ? t.wins / t.bids * 100 : 0}%` }} />
                          </div>
                          <div className='text-muted-foreground text-[10px] tabular-nums'>{t.ym.slice(5)}</div>
                        </div>
                      ))}
                    </div>
                    <div className='text-muted-foreground text-xs'>막대 = 투찰 수, 진한 부분 = 낙찰</div>
                  </div>
                )}
                {/* 최근 낙찰 */}
                {rec && rec.recentWins.length > 0 && (
                  <div>
                    <div className='mb-1 text-sm font-medium'>최근 낙찰</div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>개찰일</TableHead><TableHead>학교</TableHead>
                        <TableHead className='text-right'>기초금액</TableHead>
                        <TableHead className='text-right'>낙찰값</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {rec.recentWins.map((w, i) => (
                          <TableRow key={i}>
                            <TableCell className='tabular-nums'>{w.openedAt}</TableCell>
                            <TableCell>{w.schoolName}<span className='text-muted-foreground ml-1 text-xs'>{w.sigungu}</span></TableCell>
                            <TableCell className='text-right tabular-nums'>{won(w.basePrice)}</TableCell>
                            <TableCell className='text-right font-mono tabular-nums'>{w.bidRate?.toFixed(3)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className='text-muted-foreground text-xs'>사실 나열입니다 — 누가 이길지는 예정가 추첨이 정합니다.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
