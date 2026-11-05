/** @module 책임: 시장 자리 route 오류에서 내부 정보를 숨기고 운영자가 다시 시도하게 한다. */
'use client';

import { Button } from '@/shared/ui/button';

export default function SeatsError({ reset }: { readonly reset: () => void }) {
  return (
    <section className='mx-auto grid w-full max-w-xl gap-4 px-4 py-16 text-center' aria-labelledby='seats-error-title'>
      <h1 id='seats-error-title' className='text-xl font-semibold'>
        시장 자리를 불러오지 못했습니다
      </h1>
      <p className='text-sm text-muted-foreground'>잠시 후 다시 시도해 주세요.</p>
      <div>
        <Button onClick={reset}>다시 시도</Button>
      </div>
    </section>
  );
}
