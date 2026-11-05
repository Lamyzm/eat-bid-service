/** @module 책임: 시장 자리 화면과 로딩 화면이 함께 쓰는 배치(제목·설명·목록·자리 주기)를 소유한다. 운영자가 먼저 볼 것은 누가 어느 시장을 쥐고 있는지라 목록이 위다. */
import type { ReactNode } from 'react';

export function SeatsFrame({ form, children }: { readonly form: ReactNode; readonly children: ReactNode }) {
  return (
    <section data-slot='seats-screen' aria-labelledby='seats-title' className='mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 break-keep [overflow-wrap:anywhere] sm:px-8 [&>*]:min-w-0'>
      <header className='grid gap-1'>
        <h1 id='seats-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>
          시장 자리
        </h1>
        <p className='text-[14px] text-muted-foreground'>자리를 가진 업체만 그 시장 공고의 추천 금액을 받아요. 한 공고는 한 업체만 받아요.</p>
      </header>
      {children}
      {form}
    </section>
  );
}
