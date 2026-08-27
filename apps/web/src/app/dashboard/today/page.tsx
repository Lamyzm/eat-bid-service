'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useMarks } from '@/lib/marks';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();

type OpenRow = {
  bidNo: string; schoolName: string | null; sigungu: string | null; schoolId: string | null;
  basePrice: number | null; floorRate: number | null; deadline: string | null; category: string | null;
  anchorAmount: number | null;
  band: { dense?: { lo: number; hi: number; pct: number } } | null;
  recent3: number[]; usualN: number | null;
};
type ResultRow = { bidNo: string; schoolName: string | null; openedAt: string | null; winRate: number | null; status: string };
type ForecastRow = { schoolId: string; schoolName: string; lastOpened: string; medGapDays: number; expected: string; dueInDays: number; lastWinRate: number | null };

function dday(deadline: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms < 0) return '마감됨';
  const h = Math.floor(ms / 36e5);
  return h < 24 ? `마감 ${h}시간 전` : `마감 D-${Math.floor(h / 24)}`;
}

export default function TodayPage() {
  const { bizNos, ready } = useWorkspace();
  const { marks } = useMarks();
  const [open, setOpen] = useState<OpenRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [badges, setBadges] = useState<Record<string, { part: number; wins: number }>>({});

  useEffect(() => {
    fetch('/api/open').then(r => r.json()).then(setOpen);
    fetch('/api/schools/forecast').then(r => r.json()).then(setForecast);
  }, []);

  // 어제 채점 — 투찰함 표시분
  useEffect(() => {
    const done = Object.entries(marks).filter(([, m]) => m.s === 'done').map(([id]) => id);
    if (!done.length) return;
    fetch(`/api/results?bidNos=${done.join(',')}&bizNos=${bizNos.join(',')}`)
      .then(r => r.json())
      .then((rs: ResultRow[]) => setResults(rs.filter(r => r.status !== '대기')));
  }, [marks, bizNos]);

  // 내 전적 뱃지 배치
  useEffect(() => {
    const names = open.map(o => o.schoolName).filter(Boolean) as string[];
    if (!bizNos.length || !names.length) return;
    fetch(`/api/firms/badges?bizNos=${bizNos.join(',')}&schools=${names.map(encodeURIComponent).join(',')}`)
      .then(r => r.json()).then(setBadges);
  }, [open, bizNos]);

  const graded = useMemo(() => results.map(r => {
    const myRate = marks[r.bidNo]?.rate ?? null;
    const diff = myRate != null && r.winRate != null ? +(myRate - r.winRate).toFixed(3) : null;
    return { ...r, myRate, diff };
  }), [results, marks]);

  return (
    <div className='flex flex-1 flex-col space-y-6 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>오늘</h1>
        <p className='text-muted-foreground text-sm'>
          전국 96,000개 공고 · 630만 건 투찰 데이터 기준.
        </p>
      </div>

      {ready && bizNos.length === 0 && (
        <Card className='border-primary'>
          <CardContent className='py-4'>
            사업자번호를 등록하면 내 투찰 이력이 반영됩니다.{' '}
            <Link href='/welcome' className='text-primary font-semibold hover:underline'>사업자 등록 →</Link>
          </CardContent>
        </Card>
      )}

      {graded.length > 0 && (
        <div>
          <h2 className='mb-2 font-semibold'>개찰 결과 <span className='text-muted-foreground text-sm font-normal'>(개찰 다음 날 반영)</span></h2>
          <Card><CardContent className='divide-y p-0'>
            {graded.map(r => (
              <div key={r.bidNo} className='flex flex-wrap items-center justify-between gap-2 px-4 py-3'>
                <div className='font-medium'>{r.schoolName ?? r.bidNo}
                  <span className='text-muted-foreground ml-2 text-sm'>{r.openedAt}</span></div>
                <div className='text-[15px] tabular-nums'>
                  {r.status === '낙찰' && <><Badge className='mr-2 bg-green-600'>낙찰</Badge>{r.myRate != null && <>내 투찰 <b>{r.myRate}</b></>}</>}
                  {r.status === '밀림' && <><Badge variant='secondary' className='mr-2'>밀림</Badge>
                    {r.myRate != null ? <>내 투찰 {r.myRate} · 낙찰 {r.winRate} · <b className='text-amber-600'>{r.diff != null && r.diff > 0 ? `+${r.diff}` : r.diff} 차이</b></>
                      : <>낙찰 {r.winRate}</>}</>}
                  {r.status === '하한미달' && <><Badge variant='destructive' className='mr-2'>무효</Badge>하한 미만</>}
                  {r.status === '기록없음' && <Badge variant='outline'>기록 없음</Badge>}
                </div>
              </div>
            ))}
          </CardContent></Card>
        </div>
      )}

      <div>
        <h2 className='mb-2 font-semibold'>진행 중 공고 {open.length}건</h2>
        {open.length === 0 && (
          <Card><CardContent className='text-muted-foreground py-8 text-center text-sm'>
            진행 중인 공고가 없습니다. 신규 공고는 대체로 매달 하순에 등록됩니다.
          </CardContent></Card>
        )}
        <div className='grid gap-3 lg:grid-cols-2'>
          {open.map(o => {
            const m = marks[o.bidNo];
            const b = badges[o.schoolName ?? ''];
            return (
              <Link key={o.bidNo} href={`/dashboard/auction/${o.bidNo}`} className='block'>
                <Card className={`h-full transition-colors hover:border-primary ${m?.s === 'done' ? 'opacity-60' : m?.s === 'watch' ? 'border-primary' : ''}`}>
                  <CardHeader className='pb-2'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <CardTitle className='text-base'>{o.schoolName ?? '학교 미상'}</CardTitle>
                      <div className='flex gap-1.5'>
                        {o.category && <Badge variant='secondary'>{o.category}</Badge>}
                        {o.sigungu && !o.sigungu.includes('김해') && <Badge variant='outline'>{o.sigungu} · 자격 충족</Badge>}
                        <Badge variant='destructive'>{dday(o.deadline) ?? '마감 미상'}</Badge>
                      </div>
                    </div>
                    <CardDescription className='tabular-nums'>
                      기초 {won(o.basePrice)}원 · 하한 {o.floorRate}
                      {b && <> · <b className='text-foreground'>투찰 {b.part}회 · 낙찰 {b.wins}회</b></>}
                      {m?.s === 'done' && <> · ✓ 투찰함{m.rate ? ` (${m.rate})` : ''}</>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-wrap items-end justify-between gap-2'>
                    <div>
                      <div className='text-primary text-2xl font-bold tabular-nums'>{won(o.anchorAmount)} 원</div>
                      <div className='text-muted-foreground text-xs'>기초 × 하한</div>
                    </div>
                    <div className='text-right text-sm tabular-nums'>
                      {o.recent3.length > 0 && <div>최근 낙찰 <b>{o.recent3.map(v => v.toFixed(2)).join(' · ')}</b></div>}
                      {o.band?.dense && <div className='text-muted-foreground'>잘 나온 구간 {o.band.dense.lo.toFixed(2)}~{o.band.dense.hi.toFixed(2)}</div>}
                      {o.usualN != null && <div className='text-muted-foreground'>보통 {o.usualN}곳 참여</div>}
                      <div className='mt-1 flex justify-end gap-2 text-xs'>
                        {o.schoolId && (
                          <button className='text-primary hover:underline'
                            onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/dashboard/analysis/${encodeURIComponent(o.schoolId)}`; }}>
                            분석판
                          </button>
                        )}
                        <button className='text-muted-foreground hover:underline'
                          onClick={e => { e.preventDefault(); e.stopPropagation(); window.open('https://www.eat.co.kr', '_blank'); }}>
                          NeaT ↗
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className='mb-2 font-semibold'>발주 예정</h2>
        <Card><CardContent className='divide-y p-0'>
          {forecast.length === 0 && <p className='text-muted-foreground px-4 py-4 text-sm'>2주 내 발주 예정 학교가 없습니다.</p>}
          {forecast.slice(0, 5).map(f => (
            <div key={f.schoolId} className='px-4 py-3 text-[15px]'>
              <Link href={`/dashboard/schools/${encodeURIComponent(f.schoolId)}`}
                className='font-semibold hover:underline'>{f.schoolName}</Link>
              {' · '}발주 주기 {f.medGapDays}일 · 지난 발주 {f.lastOpened.slice(5)} · 예상{' '}
              <b>{f.dueInDays <= 0 ? '도래' : `${f.expected.slice(5)} (D-${f.dueInDays})`}</b>
              {f.lastWinRate != null && <span className='text-muted-foreground tabular-nums'> · 지난 회 낙찰 {f.lastWinRate.toFixed(2)}</span>}
            </div>
          ))}
        </CardContent></Card>
      </div>
    </div>
  );
}
