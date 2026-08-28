'use client';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import { useRegion } from '@/lib/region';
import { fetchJson } from '@/lib/fetch-json';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';

type Lookup =
  | { found: true; bizNo: string; name: string; totalBids: number; totalWins: number }
  | { found: false; bizNo: string };

export default function MyPage() {
  const { bizNos, add, remove, ready } = useWorkspace();
  const { homes, toggleHome } = useRegion();
  // 자격 지역 후보 — 내 사업자들의 참여 이력 지역 (U18)
  const [candidates, setCandidates] = useState<string[]>([]);
  const [allRegions, setAllRegions] = useState<string[]>([]);
  const [regionQ, setRegionQ] = useState('');
  const [regionsFailed, setRegionsFailed] = useState(false);
  useEffect(() => {
    if (bizNos.length === 0) { setCandidates([]); return; }
    fetch(`/api/firms/record?bizNos=${bizNos.join(',')}`).then(r => r.json())
      .then(d => setCandidates(Array.isArray(d?.regions) ? d.regions : [])).catch(() => {});
  }, [bizNos]);
  useEffect(() => {
    setRegionsFailed(false);
    fetchJson<any[]>('/api/wins/regions')
      .then(x => setAllRegions(Array.isArray(x) ? x.map(r => r.sigungu) : []))
      .catch(() => setRegionsFailed(true));
  }, []);
  const searchHits = useMemo(() => {
    const q = regionQ.trim();
    if (!q) return [];
    return allRegions.filter(r => r.includes(q) && !candidates.includes(r)).slice(0, 12);
  }, [regionQ, allRegions, candidates]);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    const bz = input.replace(/-/g, '').trim();
    if (!bz) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/firms/lookup?bizNo=${bz}`);
      setPreview(await r.json());
    } finally { setLoading(false); }
  }

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>내 사업자</h1>
        <p className='text-muted-foreground text-sm'>
          사업자번호를 등록하면 지금까지의 투찰·낙찰 기록이 바로 보입니다.
          두 개 이상 등록하면 합쳐서 봅니다.
        </p>
      </div>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base'>내 자격 지역</CardTitle>
          <CardDescription>
            참가 자격은 사무소 소재지 기준입니다. 여기서 고른 지역이 오늘 화면의 자격 판정과 헤더 지역 기준이 됩니다.
            {homes.length > 0
              ? <> 현재 <b className='text-foreground'>{homes.join(' · ')}</b>.</>
              : <> 아직 설정되지 않았습니다.</>}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {candidates.length > 0 && (
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>참여 이력이 있는 지역</div>
              <div className='flex flex-wrap gap-1.5'>
                {candidates.map(rg => (
                  <Button key={rg} size='sm' variant={homes.includes(rg) ? 'default' : 'outline'}
                    onClick={() => toggleHome(rg)}>{homes.includes(rg) ? '✓ ' : ''}{rg}</Button>
                ))}
              </div>
            </div>
          )}
          {homes.filter(h => !candidates.includes(h)).length > 0 && (
            <div>
              <div className='text-muted-foreground mb-1 text-xs'>직접 추가한 지역</div>
              <div className='flex flex-wrap gap-1.5'>
                {homes.filter(h => !candidates.includes(h)).map(rg => (
                  <Button key={rg} size='sm' variant='default' onClick={() => toggleHome(rg)}>✓ {rg}</Button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className='text-muted-foreground mb-1 text-xs'>지역 검색해서 추가</div>
            {regionsFailed && (
              <p className='text-destructive mb-1 text-xs'>지역 목록을 불러오지 못했습니다.</p>
            )}
            <Input value={regionQ} onChange={e => setRegionQ(e.target.value)}
              placeholder='예: 김해, 창원, 서초' className='w-56' />
            {searchHits.length > 0 && (
              <div className='mt-1.5 flex flex-wrap gap-1.5'>
                {searchHits.map(rg => (
                  <Button key={rg} size='sm' variant={homes.includes(rg) ? 'default' : 'outline'}
                    onClick={() => { toggleHome(rg); setRegionQ(''); }}>
                    {homes.includes(rg) ? '✓ ' : '+ '}{rg}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {bizNos.length === 0 && (
            <p className='text-muted-foreground text-xs'>사업자번호를 먼저 등록하면 참여 이력 지역이 후보로 뜹니다.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>사업자번호 등록</CardTitle>
          <CardDescription>숫자만 입력해도 됩니다 (예: 7175001228)</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex gap-2'>
            <Input value={input} onChange={e => setInput(e.target.value)}
              placeholder='사업자번호 10자리' className='max-w-60 font-mono'
              onKeyDown={e => e.key === 'Enter' && lookup()} />
            <Button onClick={lookup} disabled={loading}>{loading ? '조회 중…' : '조회'}</Button>
          </div>
          {preview && (
            preview.found ? (
              <div className='bg-muted flex flex-wrap items-center gap-3 rounded-md p-3'>
                <div>
                  <div className='font-semibold'>{preview.name}</div>
                  <div className='text-muted-foreground text-sm tabular-nums'>
                    기록 보유: 투찰 {preview.totalBids.toLocaleString()}건 · 낙찰 {preview.totalWins}건
                  </div>
                </div>
                <Button size='sm' onClick={() => { add(preview.bizNo); setPreview(null); setInput(''); }}>
                  이 사업자 등록
                </Button>
              </div>
            ) : (
              <p className='text-destructive text-sm'>
                {preview.bizNo} — 투찰 기록이 없는 번호입니다. 번호를 다시 확인해 주세요.
              </p>
            )
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>등록된 사업자 {ready ? bizNos.length : ''}곳</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          {bizNos.length === 0 && <p className='text-muted-foreground text-sm'>아직 없습니다. 위에서 등록하세요.</p>}
          {bizNos.map(bz => (
            <Badge key={bz} variant='secondary' className='gap-2 py-1.5 pl-3 font-mono text-sm'>
              {bz}
              <button onClick={() => remove(bz)} className='text-muted-foreground hover:text-destructive' aria-label='삭제'>✕</button>
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
