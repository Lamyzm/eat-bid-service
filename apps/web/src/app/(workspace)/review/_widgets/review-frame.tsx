/** @module 책임: 복기 화면과 로딩 화면이 함께 쓰는 배치(제목·머리 문장·기준 줄·본문)를 소유한다. */
import type { ReactNode } from 'react';

export function ReviewFrame({ lede, stamp, children }: { readonly lede: ReactNode; readonly stamp: ReactNode; readonly children: ReactNode }) {
  return (
    <section data-slot='review-screen' aria-labelledby='review-title' className='mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8'>
      <h1 id='review-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>복기</h1>
      <div className='mt-2.5 text-[17px] font-semibold text-muted-foreground'>{lede}</div>
      <div className='mt-2 text-[13px] text-muted-foreground'>{stamp}</div>
      {children}
    </section>
  );
}
