/** @module 책임: 하한선 자리 화면과 로딩 화면이 함께 쓰는 배치(제목·지역 막대·본문)를 소유한다. */
import type { ReactNode } from 'react';

export function FloorFrame({ bar, children }: { readonly bar: ReactNode; readonly children: ReactNode }) {
  return (
    <section data-slot='floor-screen' aria-labelledby='floor-title' className='mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 break-keep [overflow-wrap:anywhere] sm:px-8 [&>*]:min-w-0'>
      <header className='grid gap-1'>
        <h1 id='floor-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>
          하한선 자리
        </h1>
        <p className='text-[14px] text-muted-foreground'>eaT 공고지역 시군구별로 하한율 90% 공고의 하한선이 어디에 나왔는지 보여 줘요.</p>
      </header>
      {bar}
      {children}
    </section>
  );
}
