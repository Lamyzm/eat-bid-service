/**
 * 공개 조회 요약 — /s/[token] (critic 프레이밍: '성적표' 아님, 공공 개찰 결과의 요약)
 * CTA는 온보딩 하나만.
 */
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Share = {
  name?: string | null; totalBids?: number; totalWins?: number;
  pushedOut?: number; belowFloor?: number; createdAt?: string | null;
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  let data: Share | null = null;
  try {
    const res = await fetch(`${API}/api/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {}

  return (
    <div className='bg-background flex min-h-screen items-center justify-center p-4'>
      <div className='w-full max-w-lg space-y-5 text-center'>
        <div>
          <div className='text-primary text-sm font-semibold'>학교급식 입찰 인텔리전스</div>
          <h1 className='mt-1 text-2xl font-bold'>개찰 기록 조회 요약</h1>
        </div>

        {data ? (
          <>
            {data.name && <div className='text-lg font-semibold'>{data.name}</div>}
            <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
              {[['참여', data.totalBids], ['낙찰', data.totalWins],
                ['밀림', data.pushedOut], ['하한미달', data.belowFloor]].map(([l, v]) => (
                <div key={l as string} className='rounded border px-2 py-3'>
                  <div className='text-muted-foreground text-xs'>{l}</div>
                  <div className='text-xl font-bold tabular-nums'>{(v as number) ?? '-'}회</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className='text-muted-foreground'>링크가 만료됐거나 준비 중입니다.</p>
        )}

        <p className='text-muted-foreground text-sm'>
          공공 개찰 결과의 요약입니다 · 본인 전적은 본인 번호로 직접 조회하세요.
        </p>
        <Link href='/welcome'
          className='bg-primary text-primary-foreground inline-block rounded-md px-6 py-3 font-semibold'>
          내 번호로 조회 →
        </Link>
      </div>
    </div>
  );
}
