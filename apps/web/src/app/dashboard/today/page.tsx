'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import type { OpenAuction, BidResult, ForecastRow } from '@eatbid/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();
type Mark = 'none' | 'watch' | 'done';
const MKEY = 'eatbid.openStatus';

function useMarks() {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  useEffect(() => { try { const r = localStorage.getItem(MKEY); if (r) setMarks(JSON.parse(r)); } catch {} }, []);
  const set = (id: string, m: Mark) => {
    const next = { ...marks, [id]: m }; setMarks(next);
    try { localStorage.setItem(MKEY, JSON.stringify(next)); } catch {}
  };
  return { marks, set };
}

function dday(deadline: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms < 0) return '마감됨';
  const h = Math.floor(ms / 36e5);
  return h < 24 ? `마감 ${h}시간 전` : `마감 D-${Math.floor(h / 24)}`;
}

export default function TodayPage() {
  const { bizNos } = useWorkspace();
  const { marks, set } = useMarks();
  const [open, setOpen] = useState<(OpenAuction & { schoolId?: string | null })[]>([]);
  const [results, setResults] = useState<BidResult[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);

  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then(setOpen);
    fetch('/api/schools/forecast').then(r => r.json()).then(setForecast);
  }, []);

  useEffect(() => {
    const done = Object.entries(marks).filter(([, m]) => m === 'done').map(([id]) => id);
    if (!done.length) return;
    fetch(`/api/results?bidNos=${done.join(',')}&bizNos=${bizNos.join(',')}`)
      .then(r => r.json()).then((rs: BidResult[]) => setResults(rs.filter(r => r.status !== '대기')));
  }, [marks, bizNos]);

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>오늘</h1>
        <p className='text-muted-foreground text-sm'>열린 공고 · 투찰한 공고의 결과 · 다음 주 예보를 한 번에.</p>
      </div>

      {results.length > 0 && (
        <Card className='border-primary'>
          <CardHeader className='pb-2'><CardTitle className='text-base'>투찰 결과 나옴 {results.length}건</CardTitle></CardHeader>
          <CardContent className='space-y-2'>
            {results.map(r => (
              <div key={r.bidNo} className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm'>
                <div className='font-medium'>{r.schoolName ?? r.bidNo} <span className='text-muted-foreground'>{r.openedAt}</span></div>
                <div className='flex items-center gap-2 tabular-nums'>
                  {r.status === '낙찰' && <Badge className='bg-green-600'>낙찰</Badge>}
                  {r.status === '밀림' && <Badge variant='secondary'>밀림 {r.diff != null && `(+${r.diff})`}</Badge>}
                  {r.status === '하한미달' && <Badge variant='destructive'>하한 미달</Badge>}
                  {r.status === '기록없음' && <Badge variant='outline'>내 기록 없음</Badge>}
                  <span className='text-muted-foreground'>낙찰률 {r.winRate ?? '-'} / 나 {r.myRate ?? '-'}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className='mb-2 font-semibold'>현재 공고 {open.length}건</h2>
        {open.length === 0 && (
          <Card><CardContent className='text-muted-foreground py-8 text-center text-sm'>
            지금 열린 공고가 없습니다. 보통 매달 하순에 다음 달 물량이 올라옵니다.
          </CardContent></Card>
        )}
        <div className='grid gap-3 lg:grid-cols-2'>
          {open.map(o => {
            const m = marks[o.bidNo] ?? 'none';
            const href = o.schoolId
              ? `/dashboard/schools/${encodeURIComponent(o.schoolId)}?base=${o.basePrice ?? ''}&floor=${o.floorRate ?? ''}`
              : null;
            return (
              <Card key={o.bidNo} className={m === 'done' ? 'opacity-60' : m === 'watch' ? 'border-primary' : ''}>
                <CardHeader className='pb-2'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <CardTitle className='text-base'>
                      {href ? <Link className='hover:underline' href={href}>{o.schoolName}</Link> : (o.schoolName ?? '학교 미상')}
                    </CardTitle>
                    <div className='flex gap-1.5'>
                      {o.sigungu && !o.sigungu.includes('김해') && <Badge variant='outline'>{o.sigungu} 소재 · 자격 OK</Badge>}
                      <Badge variant='destructive'>{dday(o.deadline) ?? '마감 미상'}</Badge>
                    </div>
                  </div>
                  <CardDescription>기초가 {won(o.basePrice)}원 · 하한 {o.floorRate ?? '-'}
                    {href && <> · <Link href={href} className='text-primary'>이 학교 기록 보기 →</Link></>}
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex flex-wrap items-end justify-between gap-3'>
                  <div>
                    <div className='text-muted-foreground text-xs'>기준 금액 (기초가 × 하한율)</div>
                    <div className='text-primary text-2xl font-bold tabular-nums'>{won(o.anchorAmount)} 원</div>
                  </div>
                  <div className='flex gap-2'>
                    <Button size='sm' variant={m === 'watch' ? 'default' : 'outline'}
                      onClick={() => set(o.bidNo, m === 'watch' ? 'none' : 'watch')}>{m === 'watch' ? '★ 관심' : '☆ 관심'}</Button>
                    <Button size='sm' variant={m === 'done' ? 'default' : 'outline'}
                      onClick={() => set(o.bidNo, m === 'done' ? 'none' : 'done')}>{m === 'done' ? '✓ 투찰함' : '투찰 표시'}</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className='mb-2 font-semibold'>다음 주 예보 <span className='text-muted-foreground text-sm font-normal'>— 학교별 발주 주기 기준 추정 (낙찰 예측 아님)</span></h2>
        <Card>
          <CardContent className='divide-y'>
            {forecast.length === 0 && <p className='text-muted-foreground py-4 text-sm'>2주 안에 예상되는 발주가 없습니다.</p>}
            {forecast.map(f => (
              <div key={f.schoolId} className='flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm'>
                <Link href={`/dashboard/schools/${encodeURIComponent(f.schoolId)}`} className='font-medium hover:underline'>{f.schoolName}</Link>
                <div className='text-muted-foreground tabular-nums'>
                  지난 발주 {f.lastOpened} · 보통 {f.medGapDays}일 주기 →
                  <b className='text-foreground'> {f.expected}쯤</b>
                  {f.dueInDays <= 0 ? <Badge className='ml-2' variant='destructive'>지금쯤</Badge> : ` (D-${f.dueInDays})`}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
