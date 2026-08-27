/**
 * 공개 조회 요약 — /s/[token] (critic 프레이밍: '성적표' 아님, 공공 개찰 결과의 요약)
 * 서버 계약: {ok, name, totals:{part,wins,pushed,below}, recentWins[]} — ok:false도 HTTP 200.
 */
import Link from 'next/link';
import { SharePing } from './share-ping';

export const dynamic = 'force-dynamic';

type Share = {
  ok: boolean;
  error?: string;
  name?: string | null;
  totals?: { part: number; wins: number; pushed: number; below: number };
  recentWins?: {
    openedAt: string | null; schoolName: string | null; sigungu: string | null;
    basePrice: number | null; bidRate: number | null;
  }[];
};

const won = (n: number | null | undefined) => n == null ? '-' : Math.round(n).toLocaleString();

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  let data: Share | null = null;
  try {
    const res = await fetch(`${API}/api/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
    data = await res.json();
  } catch {}
  const valid = data?.ok === true && data.totals != null;

  return (
    <div className='bg-background flex min-h-screen items-center justify-center p-4'>
      <SharePing />
      <div className='w-full max-w-lg space-y-5 text-center'>
        <div>
          <div className='text-primary text-sm font-semibold'>학교급식 입찰 인텔리전스</div>
          <h1 className='mt-1 text-2xl font-bold'>개찰 기록 조회 요약</h1>
        </div>

        {valid ? (
          <>
            {data!.name && <div className='text-lg font-semibold'>{data!.name}</div>}
            <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
              {[['참여', data!.totals!.part], ['낙찰', data!.totals!.wins],
                ['밀림', data!.totals!.pushed], ['하한미달', data!.totals!.below]].map(([l, v]) => (
                <div key={l as string} className='rounded border px-2 py-3'>
                  <div className='text-muted-foreground text-xs'>{l}</div>
                  <div className='text-xl font-bold tabular-nums'>{v as number}회</div>
                </div>
              ))}
            </div>
            {(data!.recentWins?.length ?? 0) > 0 && (
              <div className='rounded border text-left'>
                <div className='border-b px-3 py-2 text-sm font-medium'>최근 낙찰</div>
                <div className='divide-y'>
                  {data!.recentWins!.map((w, i) => (
                    <div key={i} className='flex items-center justify-between px-3 py-2 text-sm tabular-nums'>
                      <span className='truncate pr-2'>
                        <span className='text-muted-foreground'>{w.openedAt}</span>{' '}
                        {w.schoolName}<span className='text-muted-foreground ml-1 text-xs'>{w.sigungu}</span>
                      </span>
                      <span className='shrink-0 font-mono'>
                        {won(w.basePrice)}원 · {w.bidRate?.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className='text-muted-foreground'>링크가 만료됐거나 올바르지 않습니다.</p>
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
