'use client';
import { useEffect, useState } from 'react';
import type { OpenAuction } from '@eatbid/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';

const won = (n: number | null) => n == null ? '-' : Math.round(n).toLocaleString();
type Status = 'none' | 'watch' | 'done';
const KEY = 'eatbid.openStatus';

function useStatus() {
  const [st, setSt] = useState<Record<string, Status>>({});
  useEffect(() => {
    try { const r = localStorage.getItem(KEY); if (r) setSt(JSON.parse(r)); } catch {}
  }, []);
  const set = (bidNo: string, s: Status) => {
    const next = { ...st, [bidNo]: s };
    setSt(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  };
  return { st, set };
}

function dday(deadline: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  const h = Math.floor(ms / 36e5);
  if (ms < 0) return '마감됨';
  if (h < 24) return `마감 ${h}시간 전`;
  return `마감 D-${Math.floor(h / 24)}`;
}

export default function OpenPage() {
  const [rows, setRows] = useState<OpenAuction[]>([]);
  const { st, set } = useStatus();

  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then(setRows);
  }, []);

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>현재 공고 {rows.length}건</h1>
        <p className='text-muted-foreground text-sm'>
          개찰 전 공고입니다. 기준 금액 = 기초가 × 하한율(공고에 나온 값).
          관심·투찰 표시는 이 브라우저에만 저장됩니다.
        </p>
      </div>

      {rows.length === 0 && (
        <Card><CardContent className='text-muted-foreground py-10 text-center text-sm'>
          지금 열린 공고가 없습니다. 보통 매달 하순에 다음 달 물량이 올라옵니다.
        </CardContent></Card>
      )}

      <div className='grid gap-3 lg:grid-cols-2'>
        {rows.map(o => {
          const s = st[o.bidNo] ?? 'none';
          return (
            <Card key={o.bidNo} className={s === 'done' ? 'opacity-60' : s === 'watch' ? 'border-primary' : ''}>
              <CardHeader className='pb-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <CardTitle className='text-base'>{o.schoolName ?? '학교 미상'}</CardTitle>
                  <div className='flex gap-1.5'>
                    {o.sigungu && !o.sigungu.includes('김해') && (
                      <Badge variant='outline'>{o.sigungu} 소재 · 자격 OK</Badge>
                    )}
                    <Badge variant='destructive'>{dday(o.deadline) ?? '마감 미상'}</Badge>
                  </div>
                </div>
                <CardDescription>기초가 {won(o.basePrice)}원 · 하한 {o.floorRate ?? '-'}</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-wrap items-end justify-between gap-3'>
                <div>
                  <div className='text-muted-foreground text-xs'>기준 금액 (기초가 × 하한율)</div>
                  <div className='text-primary text-2xl font-bold tabular-nums'>{won(o.anchorAmount)} 원</div>
                </div>
                <div className='flex gap-2'>
                  <Button size='sm' variant={s === 'watch' ? 'default' : 'outline'}
                    onClick={() => set(o.bidNo, s === 'watch' ? 'none' : 'watch')}>
                    {s === 'watch' ? '★ 관심' : '☆ 관심'}
                  </Button>
                  <Button size='sm' variant={s === 'done' ? 'default' : 'outline'}
                    onClick={() => set(o.bidNo, s === 'done' ? 'none' : 'done')}>
                    {s === 'done' ? '✓ 투찰함' : '투찰 표시'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
