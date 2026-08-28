'use client';
/**
 * 내 성적 — 행당 3단 스택(낙찰가/2등가/내 값 + 차이) + 아깝게 진 판 + 사업자 합산/개별
 * 스펙 v2·v3: 비드큐 '나의 투찰결과' 문법 + 우리 독점(2등가·실효하한)
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useSession } from '@/lib/session';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { useTrack, getSid } from '@/lib/track';
import { toast } from 'sonner';
import { won } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Row = {
  bidId: string; bizNo: string; openedAt: string | null; schoolName: string | null;
  sigungu: string | null; category: string | null; basePrice: number | null; floorRate: number | null;
  bidRate: number | null; won: boolean; winRate: number | null; secondRate: number | null;
  nBids: number | null; effFloor: number | null;
};


export default function RecordPage() {
  useTrack('record');
  const { bizNos, ready } = useWorkspace();
  const { guest, googleEnabled } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [ties, setTies] = useState<{ openedAt: string | null; schoolName: string | null; sigungu: string | null; bidRate: number | null; nTied: number; won: boolean; winRate: number | null }[]>([]);
  const [biz, setBiz] = useState<string | null>(null); // null = 합산
  const [months, setMonths] = useState(12);
  const [limit, setLimit] = useState(300); // 서버에서 받아오는 행 수 (U11: 초기 페이로드 축소)
  const [loadingMore, setLoadingMore] = useState(false);
  const [kpiOpen, setKpiOpen] = useState(false);
  useEffect(() => { try { setKpiOpen(localStorage.getItem('eatbid.kpiOpen') === '1'); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('eatbid.kpiOpen', kpiOpen ? '1' : '0'); } catch {} }, [kpiOpen]);

  useEffect(() => {
    if (bizNos.length === 0) return;
    setLoadingMore(true);
    fetch(`/api/firms/bids?bizNos=${bizNos.join(',')}&limit=${limit}&withTotal=1`).then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : (d.rows ?? []));
      setTotal(Array.isArray(d) ? null : (d.total ?? null));
    }).finally(() => setLoadingMore(false));
    fetch(`/api/firms/ties?bizNos=${bizNos.join(',')}`).then(r => r.json())
      .then(x => setTies(Array.isArray(x) ? x : [])).catch(() => {});
  }, [bizNos, limit]);

  const cutoff = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }, [months]);
  const view = useMemo(() => rows
    .filter(r => (biz == null || r.bizNo === biz) && (r.openedAt ?? '') >= cutoff)
    .sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '')), [rows, biz, cutoff]);

  const wins = view.filter(r => r.won);
  const losses = view.filter(r => !r.won && r.bidRate != null && r.winRate != null);
  const below = losses.filter(r => r.bidRate! < r.winRate!); // 승자보다 낮음 = 하한미달 무효
  const pushed = losses.filter(r => r.bidRate! >= r.winRate!);
  // 아깝게 진 판: 내가 2등 (승자 위 최저가 = 내 값)
  const runnerUps = pushed.filter(r => r.secondRate != null && Math.abs(r.bidRate! - r.secondRate!) < 1e-9);
  const ruGaps = runnerUps.map(r => +(r.bidRate! - r.winRate!).toFixed(3)).sort((a, b) => a - b);
  const ruMed = ruGaps.length ? ruGaps[Math.floor(ruGaps.length / 2)] : null;
  const winSum = wins.reduce((s, r) => s + (r.basePrice ?? 0) * (r.bidRate ?? 0) / 100, 0);

  if (ready && bizNos.length === 0) return (
    <div className='p-8'>
      <h1 className='mb-2 text-2xl font-semibold'>내 성적</h1>
      <p>사업자번호를 등록하면 과거 투찰 전체가 채점됩니다.{' '}
        <Link href='/welcome' className='text-primary font-semibold hover:underline'>사업자 등록 →</Link></p>
    </div>
  );

  return (
    <div className='flex flex-1 flex-col space-y-5 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>내 성적</h1>
          <p className='text-muted-foreground text-sm tabular-nums'>
            최근 {months}개월 · {view.length}회 투찰 · 낙찰 계약액 {won(winSum)}원
            {total != null && total > rows.length && <> · 표시 {rows.length.toLocaleString()}건/전체 {total.toLocaleString()}건</>}
          </p>
        </div>
        <div className='flex flex-wrap gap-1.5'>
          <Button size='sm' variant={biz === null ? 'default' : 'outline'} onClick={() => setBiz(null)}>
            합산 ({bizNos.length}개 사업자)
          </Button>
          {bizNos.map(b => (
            <Button key={b} size='sm' variant={biz === b ? 'default' : 'outline'} onClick={() => setBiz(b)}>
              {b.slice(0, 3)}-{b.slice(3, 5)}-{b.slice(5)}
            </Button>
          ))}
          <span className='mx-1' />
          {[6, 12, 24, 60].map(m => (
            <Button key={m} size='sm' variant={months === m ? 'default' : 'outline'} onClick={() => setMonths(m)}>{m}개월</Button>
          ))}
          <Button size='sm' variant='outline' onClick={async () => {
            try {
              // 계약: {bizNo(10자리 단일), session} — 합산이 아닌 대표 사업자 1개 발급
              const res = await fetch('/api/share', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bizNo: biz ?? bizNos[0], session: getSid() }),
              });
              const d = await res.json();
              if (d?.ok !== true || !d.token) throw new Error(d?.error);
              await navigator.clipboard?.writeText(`${location.origin}/s/${d.token}`);
              // share_create 이벤트는 서버(ShareController.create)가 기록 — 클라 중복 집계 금지
              toast.success('조회 요약 링크가 복사됐습니다.');
            } catch {
              toast.error('공유 링크를 만들지 못했습니다. 잠시 후 다시 시도하세요.');
            }
          }}>조회 요약 공유</Button>
          <Button size='sm' variant='outline' onClick={() => {
            const head = '개찰일,학교,시군구,품목,기초금액,하한,낙찰가,2등가,내값,결과';
            const lines = view.map(r => {
              const st = r.won ? '낙찰' : r.bidRate != null && r.winRate != null && r.bidRate < r.winRate ? '무효' : '밀림';
              return [r.openedAt, r.schoolName, r.sigungu, r.category, r.basePrice ?? '', r.floorRate ?? '',
                r.winRate ?? '', r.secondRate ?? '', r.bidRate ?? '', st].join(',');
            });
            const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `내성적_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
          }}>CSV 저장</Button>
        </div>
      </div>

      {guest && googleEnabled && (
        <p className='text-muted-foreground text-sm'>로그인하면 다른 PC에서도 이어서 봅니다.</p>
      )}

      {/* KPI — 2칸 + 상세 접힘 (D) */}
      <div className='grid grid-cols-2 gap-2' style={{ minHeight: 88 }}>
        {[['참여', `${view.length}회`, ''], ['낙찰률', view.length ? `${(wins.length / view.length * 100).toFixed(1)}%` : '—', 'text-primary']].map(([label, v, cls]) => (
          <Card key={label as string}><CardContent className='px-4 py-3'>
            <div className='text-muted-foreground text-xs'>{label}</div>
            <div className={`text-3xl font-bold tabular-nums ${cls}`}>{v}</div>
          </CardContent></Card>
        ))}
      </div>
      <button type='button' className='text-muted-foreground hover:text-foreground -mt-3 self-start text-sm'
        onClick={() => setKpiOpen(v => !v)}>
        {kpiOpen ? '자세히 접기 ▲' : '자세히 보기 ▼ (낙찰·밀림·무효)'}
      </button>
      {kpiOpen && (
        <div className='grid grid-cols-3 gap-2'>
          {[['낙찰', `${wins.length}회`, 'text-primary'],
            ['밀림 (남이 더 낮게 씀)', `${pushed.length}회`, 'text-amber-600'],
            ['무효 (하한 아래)', `${below.length}회`, 'text-destructive']].map(([label, v, cls]) => (
            <Card key={label as string}><CardContent className='px-4 py-3'>
              <div className='text-muted-foreground text-xs'>{label}</div>
              <div className={`text-xl font-bold tabular-nums ${cls}`}>{v}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* 아깝게 진 판 */}
      {runnerUps.length > 0 && (
        <Card>
          <CardContent className='py-4 text-[15px] tabular-nums'>
            <b>아깝게 진 판</b> — 최근 {months}개월 동안 <b className='text-amber-600'>{runnerUps.length}번 2등</b>
            이었고, 낙찰가와의 차이 중앙값은 <b>{ruMed?.toFixed(3)}</b>이었습니다.
            {ruMed != null && ruMed <= 0.05 && ' 종이 한 장 차이입니다.'}
          </CardContent>
        </Card>
      )}

      {/* 동가 충돌 이력 — 과거형 사실. 승률·비율 요약 금지 */}
      {ties.length > 0 && (
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>동가 충돌 이력</CardTitle>
            <CardDescription>같은 값이 겹치면 추첨으로 갈립니다 — 내가 겹쳤던 회차들.</CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto', minHeight: 160 }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>개찰일</TableHead><TableHead>학교</TableHead>
                  <TableHead className='text-right'>내 값</TableHead>
                  <TableHead className='text-right'>동가</TableHead>
                  <TableHead>결과</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {ties.map((t, i) => {
                    const st = t.won ? '낙찰' : t.bidRate != null && t.winRate != null && t.bidRate < t.winRate ? '무효' : '밀림';
                    return (
                      <TableRow key={i}>
                        <TableCell className='tabular-nums'>{t.openedAt}</TableCell>
                        <TableCell>
                          {t.sigungu && t.schoolName ? (
                            <Link href={`/dashboard/analysis/${encodeURIComponent(`${t.sigungu}|${t.schoolName}`)}`}
                              className='font-medium hover:underline'>{t.schoolName}</Link>
                          ) : (t.schoolName ?? '-')}
                        </TableCell>
                        <TableCell className='text-right font-mono tabular-nums'>{t.bidRate?.toFixed(3)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{t.nTied}곳</TableCell>
                        <TableCell>
                          {st === '낙찰' && <Badge className='bg-primary'>낙찰</Badge>}
                          {st === '밀림' && <Badge variant='secondary'>밀림</Badge>}
                          {st === '무효' && <Badge variant='destructive'>무효</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3단 스택 표 */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>투찰 내역</CardTitle>
          <CardDescription>
            각 행: 낙찰가 · 2등가 · 내 값(차이). 학교 클릭 = 분석판.
            {total != null && rows.length < total && <> KPI·요약은 <b>불러온 {rows.length.toLocaleString()}건</b> 기준입니다 (전체 {total.toLocaleString()}건 — [더 보기]로 넓힐 수 있습니다).</>}
          </CardDescription>
        </CardHeader>
        <CardContent className='p-0'>
          <div style={{ overflowX: 'auto', maxHeight: 640, overflowY: 'auto', minHeight: 320 }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead>개찰일</TableHead><TableHead>학교</TableHead><TableHead>품목</TableHead>
                <TableHead className='text-right'>기초금액</TableHead>
                <TableHead className='text-right'>낙찰가 / 2등가 / 내 값</TableHead>
                <TableHead className='text-right'>참여</TableHead>
                <TableHead>결과</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {view.map(r => {
                  const diff = r.bidRate != null && r.winRate != null ? +(r.bidRate - r.winRate).toFixed(3) : null;
                  const isRunnerUp = !r.won && r.secondRate != null && r.bidRate != null && Math.abs(r.bidRate - r.secondRate) < 1e-9;
                  const status = r.won ? '낙찰' : r.bidRate != null && r.winRate != null && r.bidRate < r.winRate ? '하한미달' : '밀림';
                  return (
                    <TableRow key={`${r.bidId}|${r.bizNo}`} className={r.won ? 'bg-primary/5' : ''}>
                      <TableCell className='align-top tabular-nums'>{r.openedAt}</TableCell>
                      <TableCell className='align-top'>
                        {r.sigungu && r.schoolName ? (
                          <Link href={`/dashboard/analysis/${encodeURIComponent(`${r.sigungu}|${r.schoolName}`)}`}
                            className='font-medium hover:underline'>{r.schoolName}</Link>
                        ) : (r.schoolName ?? '-')}
                        <div className='text-muted-foreground text-xs'>{r.sigungu}</div>
                      </TableCell>
                      <TableCell className='align-top'>{r.category ?? '-'}</TableCell>
                      <TableCell className='content-center text-right tabular-nums'>{won(r.basePrice)}</TableCell>
                      <TableCell className='text-right font-mono text-[13px] tabular-nums'>
                        <div className='text-primary'>낙찰 {r.winRate?.toFixed(3) ?? '—'}</div>
                        <div className='text-muted-foreground'>2등 {r.secondRate?.toFixed(3) ?? '—'}</div>
                        <div className={r.won ? 'font-bold' : ''}>
                          내&nbsp; {r.bidRate?.toFixed(3) ?? '—'}
                          {diff != null && diff !== 0 && (
                            <span className={diff > 0 ? 'text-amber-600' : 'text-destructive'}> ({diff > 0 ? '+' : ''}{diff})</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='content-center text-right tabular-nums'>{r.nBids ?? '-'}곳</TableCell>
                      <TableCell className='content-center'>
                        {status === '낙찰' && <Badge className='bg-primary'>낙찰</Badge>}
                        {status === '밀림' && <Badge variant='secondary'>{isRunnerUp ? '2등' : '밀림'}</Badge>}
                        {status === '하한미달' && <Badge variant='destructive'>무효</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {total != null && rows.length < total && (
                  <TableRow>
                    <TableCell colSpan={7} className='py-3 text-center'>
                      <Button size='sm' variant='outline' disabled={loadingMore}
                        onClick={() => setLimit(n => Math.min(n + 500, 5000))}>
                        {loadingMore ? '불러오는 중…' : `더 보기 (${rows.length.toLocaleString()} / ${total.toLocaleString()}건)`}
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {view.length === 0 && (
                  <TableRow><TableCell colSpan={7} className='py-6'>
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>이 기간의 투찰 기록이 없습니다</EmptyTitle>
                        <EmptyDescription>기간을 늘리거나 다른 사업자를 선택해 보세요.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className='text-muted-foreground text-xs'>
        하한미달(무효) = 낙찰가보다 낮게 쓴 경우. 예정가는 추첨입니다 — 추천가는 없습니다, 판단 재료는 전부 있습니다.
      </p>
    </div>
  );
}
