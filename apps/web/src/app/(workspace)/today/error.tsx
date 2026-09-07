/** @module 책임: 오늘 route 오류에서 내부 정보를 숨기고 조회 불가를 빈 목록으로 위장하지 않은 채 다시 시도하게 한다. */
'use client';

import { Button } from '@/shared/ui/button';

type TodayErrorProps = {
  readonly reset: () => void;
};

export default function TodayError({ reset }: TodayErrorProps) {
  return (
    <section
      className='mx-auto grid w-full max-w-xl gap-4 px-4 py-16 text-center'
      aria-labelledby='today-error-title'
    >
      <h1 id='today-error-title' className='text-xl font-semibold'>
        열린 공고 목록을 불러오지 못했습니다
      </h1>
      <p className='text-sm text-muted-foreground'>잠시 후 다시 시도해 주세요.</p>
      <div>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </section>
  );
}
