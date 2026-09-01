/** @module 책임: 공고 route 오류에서 내부 정보를 숨기고 사용자가 요청을 다시 시도하게 한다. */
'use client';

import { Button } from '@/shared/ui/button';

type AuctionErrorProps = {
  readonly reset: () => void;
};

export default function AuctionError({ reset }: AuctionErrorProps) {
  return (
    <section
      className='mx-auto grid w-full max-w-xl gap-4 px-4 py-16 text-center'
      aria-labelledby='auction-error-title'
    >
      <h1 id='auction-error-title' className='text-xl font-semibold'>
        공고 정보를 불러오지 못했습니다
      </h1>
      <p className='text-sm text-muted-foreground'>잠시 후 다시 시도해 주세요.</p>
      <div>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </section>
  );
}
