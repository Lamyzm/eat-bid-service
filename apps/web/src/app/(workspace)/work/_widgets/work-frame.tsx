/** @module 책임: 넣을 공고 화면과 로딩 화면이 함께 쓰는 배치(제목·기준 시각·본문)를 소유한다. */
import type { ReactNode } from 'react';

export function WorkFrame({ stamp, children }: { readonly stamp: ReactNode; readonly children: ReactNode }) {
  return (
    <section data-slot='work-screen' aria-labelledby='work-title' className='mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <h1 id='work-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>넣을 공고</h1>
        <div className='text-[15px] font-semibold text-muted-foreground'>{stamp}</div>
      </div>
      {children}
    </section>
  );
}
