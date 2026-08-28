'use client';
/**
 * 온보딩 — "사업자번호 하나로 과거가 전부 뜬다"
 * 스펙 v3 ⑦: 스케일 → 입력 → 온보딩 폭탄(내 기록 즉시) → 2번째 사업자(1.9배) → 시작
 * R5 ⑩: 첫 화면에 제품 증거(실데이터 미리보기)와 Google 로그인을 함께 둔다.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace';
import { useRegion } from '@/lib/region';
import { boot, useSession } from '@/lib/session';
import { signInGoogle } from '@/lib/auth-client';
import { useTrack } from '@/lib/track';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Lookup = { found: boolean; bizNo: string; name?: string; totalBids?: number; totalWins?: number };
type Rec = { totalBids: number; totalWins: number; pushedOut: number; belowFloor: number; regions?: string[] };
type Win = {
  bidId: string; schoolName: string; openedAt: string; floorRate: number | null;
  winRate: number | null; nValid: number; nBids: number | null;
};

/** 최근 낙찰률 점 스트립 — 실데이터 미리보기 (공고 상세 strip-chart와 같은 문법) */
function PreviewStrip({ values, floor }: { values: number[]; floor: number }) {
  if (values.length < 4) return null;
  const W = 480, H = 120, L = 16, R = 16, base = H - 34;
  const CAP = floor + 0.5;
  const capped = values.filter(v => v <= CAP);
  const outN = values.length - capped.length;
  const xMin = floor - 0.015;
  const xMax = Math.max(floor + 0.15, ...capped.map(v => v + 0.02));
  const X = (v: number) => L + (W - L - R) * (v - xMin) / (xMax - xMin);
  const stacks = new Map<number, number>();
  for (const v of capped) {
    const k = Math.round(v * 100) / 100;
    stacks.set(k, (stacks.get(k) ?? 0) + 1);
  }
  const mono = 'var(--font-mono, monospace)';
  const ticks: number[] = [];
  for (let v = Math.ceil(xMin / 0.1) * 0.1; v <= xMax + 1e-9; v += 0.1) ticks.push(Math.round(v * 100) / 100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role='img'
      aria-label={`최근 낙찰률 분포 (하한 ${floor})`}>
      <line x1={L} y1={base} x2={W - R} y2={base} stroke='var(--border)' />
      <line x1={X(floor)} y1={10} x2={X(floor)} y2={base} stroke='var(--destructive)' strokeWidth={2} />
      <text x={X(floor)} y={base + 26} textAnchor='middle' fontSize={12} fontWeight={700}
        fill='var(--destructive)' fontFamily={mono}>하한 {floor}</text>
      {ticks.map(v => (
        <g key={v}>
          <line x1={X(v)} y1={base} x2={X(v)} y2={base + 4} stroke='var(--border)' />
          {Math.abs(v - floor) > 0.04 && (
            <text x={X(v)} y={base + 14} textAnchor='middle' fontSize={11}
              fill='var(--muted-foreground)' fontFamily={mono}>{v.toFixed(1)}</text>
          )}
        </g>
      ))}
      {[...stacks.entries()].map(([k, n]) => Array.from({ length: Math.min(n, 6) }, (_, i) => (
        <circle key={`${k}-${i}`} cx={X(k)} cy={base - 8 - i * 11} r={4.5}
          fill='var(--primary)' opacity={0.75}>
          <title>{k.toFixed(2)} · {n}회</title>
        </circle>
      )))}
      <text x={W - R} y={12} textAnchor='end' fontSize={12} fill='var(--muted-foreground)'>
        {values.length}회{outN > 0 ? ` · ${CAP.toFixed(2)} 초과 ${outN}건 생략` : ''}
      </text>
    </svg>
  );
}

export default function WelcomePage() {
  useTrack('welcome');
  const router = useRouter();
  const { bizNos, add } = useWorkspace();
  const { homes, toggleHome } = useRegion();
  const { guest, googleEnabled } = useSession();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ lookup: Lookup; rec: Rec | null }[]>([]);

  // 세션 부팅 — 대시보드 밖이라 SessionBoot가 없다. googleEnabled 판정에 필요
  useEffect(() => { void boot(); }, []);

  // 제품 증거 — 실데이터 미리보기 (진행 중 공고 수 + 최근 개찰)
  const [openN, setOpenN] = useState<number | null>(null);
  const [recent, setRecent] = useState<Win[]>([]);
  useEffect(() => {
    fetch('/api/open').then(r => r.json())
      .then(xs => setOpenN(Array.isArray(xs) ? xs.length : null)).catch(() => {});
    fetch('/api/wins/recent?days=30').then(r => r.json())
      .then(d => setRecent(Array.isArray(d) ? d : (d.rows ?? []))).catch(() => {});
  }, []);
  // 미리보기 표는 학교가 겹치지 않게 — 같은 날 다건 개찰이 한 학교로만 채워지는 것 방지
  const recentUniq = (() => {
    const seen = new Set<string>(); const out: Win[] = [];
    for (const w of recent) {
      if (seen.has(w.schoolName)) continue;
      seen.add(w.schoolName); out.push(w);
      if (out.length >= 5) break;
    }
    return out;
  })();
  const strip90 = recent.filter(w => w.floorRate === 90 && w.winRate != null).map(w => w.winRate!);

  const check = async () => {
    const bz = input.replace(/-/g, '').trim();
    if (bz.length !== 10) return;
    setBusy(true);
    try {
      const lookup: Lookup = await fetch(`/api/firms/lookup?bizNo=${bz}`).then(r => r.json());
      const rec: Rec | null = lookup.found
        ? await fetch(`/api/firms/record?bizNos=${bz}`).then(r => r.json()) : null;
      add(bz);
      setHits(h => [...h, { lookup, rec }]);
      setInput('');
      setStep(hits.length === 0 ? 2 : 3);
    } finally { setBusy(false); }
  };

  const total = hits.reduce((s, h) => s + (h.rec?.totalBids ?? 0), 0);
  const wins = hits.reduce((s, h) => s + (h.rec?.totalWins ?? 0), 0);
  // 자격 지역 후보 — 참여 이력에서 유도(제안까지만), 확정은 선택으로
  const regionCands = [...new Set(hits.flatMap(h => h.rec?.regions ?? []))].slice(0, 8);

  return (
    <div className='bg-background flex min-h-screen items-center justify-center p-4 md:p-6'>
      <div className='w-full max-w-5xl space-y-6'>
        <div className='text-center'>
          <div className='text-primary text-sm font-semibold'>학교급식 입찰 인텔리전스</div>
          <h1 className='mt-1 text-3xl font-bold'>얼마 쓸지 고민되는 밤,<br />판단 재료는 전부 여기 있습니다</h1>
          <p className='text-muted-foreground mt-2 tabular-nums'>
            공공 개찰 결과를 정리해 보여줍니다
          </p>
        </div>

        <div className='grid items-start gap-6 lg:grid-cols-2'>
          {/* 좌: 시작 흐름 */}
          <div className='space-y-4'>
            {step === 1 && (
              <Card>
                <CardContent className='space-y-3 p-6'>
                  <div className='font-medium'>사업자번호 10자리</div>
                  <p className='text-muted-foreground text-sm'>입력하면 과거 투찰 기록이 바로 조회됩니다.</p>
                  <div className='flex gap-2'>
                    <Input value={input} onChange={e => setInput(e.target.value)}
                      placeholder='000-00-00000' className='font-mono text-lg' inputMode='numeric'
                      onKeyDown={e => e.key === 'Enter' && check()} />
                    <Button onClick={check} disabled={busy || input.replace(/[^0-9]/g, '').length !== 10}>
                      {busy ? '조회 중…' : '확인'}
                    </Button>
                  </div>
                  {guest && googleEnabled && (
                    <div className='space-y-2 border-t pt-3'>
                      <Button variant='outline' className='w-full' onClick={() => void signInGoogle()}>
                        Google로 시작하기
                      </Button>
                      <p className='text-muted-foreground text-xs'>
                        로그인하면 사업자·지역·투찰 저장이 다른 PC에서도 이어집니다.
                      </p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    <Link href='/dashboard/today' className='hover:text-foreground underline'>등록 없이 오늘 공고 먼저 보기 →</Link>
                  </p>
                </CardContent>
              </Card>
            )}

            {step >= 2 && hits.map((h, i) => (
              <Card key={i} className={h.lookup.found ? 'border-primary' : ''}>
                <CardContent className='p-6'>
                  {h.lookup.found ? (
                    <>
                      <div className='text-lg font-semibold'>{h.lookup.name} — 기록이 이미 있습니다</div>
                      <div className='mt-2 grid grid-cols-2 gap-2 text-center md:grid-cols-4'>
                        {[['참여', h.rec?.totalBids], ['낙찰', h.rec?.totalWins],
                          ['밀림', h.rec?.pushedOut], ['하한미달', h.rec?.belowFloor]].map(([l, v]) => (
                          <div key={l as string} className='rounded border px-2 py-2'>
                            <div className='text-muted-foreground text-xs'>{l}</div>
                            <div className='text-xl font-bold tabular-nums'>{v as number}회</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div>
                      <b>{h.lookup.bizNo}</b> — 투찰 기록이 없는 번호입니다. 등록은 됐고, 첫 투찰부터 기록됩니다.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {step === 2 && (
              <Card>
                <CardContent className='space-y-3 p-6'>
                  <div className='font-medium'>사업자가 하나 더 있습니까?</div>
                  <p className='text-muted-foreground text-sm'>
                    같은 집 두 사업자로 함께 참여한 경우, 한쪽만 볼 때보다 시야가 넓어집니다.
                    두 번호의 성적이 합산으로 관리됩니다.
                  </p>
                  <div className='flex gap-2'>
                    <Input value={input} onChange={e => setInput(e.target.value)}
                      placeholder='두 번째 사업자번호 (선택)' className='font-mono' inputMode='numeric'
                      onKeyDown={e => e.key === 'Enter' && check()} />
                    <Button variant='outline' onClick={check} disabled={busy || input.replace(/[^0-9]/g, '').length !== 10}>추가</Button>
                    <Button onClick={() => setStep(3)}>건너뛰기</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card className='border-primary'>
                <CardContent className='space-y-3 p-6 text-center'>
                  <div className='text-lg font-semibold tabular-nums'>
                    {bizNos.length}개 사업자 · 참여 {total}회 · 낙찰 {wins}회가 연결됐습니다
                  </div>
                  {regionCands.length > 0 && (
                    <div className='space-y-1.5'>
                      <div className='text-sm font-medium'>내 자격 지역 <span className='text-muted-foreground font-normal'>(참여 이력 기준 제안 — 사무소 소재지들을 고르세요, 복수 선택)</span></div>
                      <div className='flex flex-wrap justify-center gap-1.5'>
                        {regionCands.map(rg => (
                          <Button key={rg} size='sm' variant={homes.includes(rg) ? 'default' : 'outline'}
                            onClick={() => toggleHome(rg)}>{rg}</Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className='text-muted-foreground text-sm'>
                    오늘 열린 공고부터 보세요. 공고마다 그 학교의 과거·구간·참여 업체가 붙어 있습니다.
                  </p>
                  <Button size='lg' className='w-full' onClick={() => router.push('/dashboard/today')}>
                    오늘 공고 보러 가기 →
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* 우: 제품 증거 — 실데이터 미리보기 (가짜 스크린샷 없음) */}
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base'>지금 돌아가는 판</CardTitle>
              <CardDescription>실제 적재 데이터 기준입니다. 등록하면 전체가 열립니다.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {openN != null && (
                <div>
                  <div className='text-muted-foreground text-xs'>진행 중 공고</div>
                  <div className='text-3xl font-bold tabular-nums'>{openN.toLocaleString()}<span className='text-muted-foreground ml-1 text-base font-normal'>건</span></div>
                </div>
              )}
              {strip90.length >= 4 && (
                <div>
                  <div className='mb-1 text-sm font-medium'>최근 30일 낙찰률 <span className='text-muted-foreground font-normal'>(하한 90 공고)</span></div>
                  <PreviewStrip values={strip90} floor={90} />
                </div>
              )}
              {recent.length > 0 && (
                <div>
                  <div className='mb-1 text-sm font-medium'>최근 개찰</div>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>개찰일</TableHead><TableHead>학교</TableHead>
                      <TableHead className='text-right'>낙찰률</TableHead>
                      <TableHead className='text-right'>참여</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {recentUniq.map(w => (
                        <TableRow key={w.bidId}>
                          <TableCell className='tabular-nums'>{w.openedAt}</TableCell>
                          <TableCell className='max-w-[160px] truncate'>{w.schoolName}</TableCell>
                          <TableCell className='text-right font-mono font-semibold tabular-nums'>{w.winRate?.toFixed(3) ?? '-'}</TableCell>
                          <TableCell className='text-right tabular-nums'>{w.nBids ?? w.nValid}곳</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {openN == null && recent.length === 0 && (
                <p className='text-muted-foreground py-8 text-center text-sm'>미리보기를 불러오는 중입니다…</p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className='text-muted-foreground text-center text-xs'>
          학교별 기록은 지역에 따라 최근 90일부터 제공됩니다. 예정가는 추첨으로 정해집니다 ·
          추천가는 없습니다 · 판단 재료를 전부 제공합니다.
        </p>
      </div>
    </div>
  );
}
