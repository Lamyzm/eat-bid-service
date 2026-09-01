'use client';

import { Button } from '@/shared/ui/button';

type AuctionErrorProps = {
  readonly reset: () => void;
};

/** 내부 오류 본문을 노출하지 않고 안전한 재시도 동작만 제공한다. */
export default function AuctionError({ reset }: AuctionErrorProps) {
  return (
    <main className='mx-auto grid w-full max-w-xl gap-4 px-4 py-16 text-center'>
      <h1 className='text-xl font-semibold'>공고 정보를 불러오지 못했습니다</h1>
      <p className='text-sm text-muted-foreground'>잠시 후 다시 시도해 주세요.</p>
      <div>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </main>
  );
}
