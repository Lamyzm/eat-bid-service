'use client';
/**
 * 온보딩 — "사업자번호 하나로 과거가 전부 뜬다"
 * 스펙 v3 ⑦: 스케일 → 입력 → 온보딩 폭탄(내 기록 즉시) → 2번째 사업자(1.9배) → 시작
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace';
import { useRegion } from '@/lib/region';
import { useTrack } from '@/lib/track';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type Lookup = { found: boolean; bizNo: string; name?: string; totalBids?: number; totalWins?: number };
type Rec = { totalBids: number; totalWins: number; pushedOut: number; belowFloor: number; regions?: string[] };

export default function WelcomePage() {
  useTrack('welcome');
  const router = useRouter();
  const { bizNos, add } = useWorkspace();
  const { homes, toggleHome } = useRegion();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ lookup: Lookup; rec: Rec | null }[]>([]);

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
    <div className='bg-background flex min-h-screen items-center justify-center p-4'>
      <div className='w-full max-w-xl space-y-6'>
        <div className='text-center'>
          <div className='text-primary text-sm font-semibold'>학교급식 입찰 인텔리전스</div>
          <h1 className='mt-1 text-3xl font-bold'>얼마 쓸지 고민되는 밤,<br />판단 재료는 전부 여기 있습니다</h1>
          <p className='text-muted-foreground mt-2 tabular-nums'>
            전국 137개 시군구 · 공고 10만 건 · 투찰 694만
          </p>
        </div>

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

        <p className='text-muted-foreground text-center text-xs'>
          학교별 기록은 지역에 따라 최근 90일부터 제공됩니다.
        </p>
        <p className='text-muted-foreground text-center text-xs'>
          예정가는 추첨으로 정해집니다. 추천가는 없습니다 — 판단 재료를 전부 제공합니다.
        </p>
      </div>
    </div>
  );
}
