'use client';
import { useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
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
