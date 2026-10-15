/** @module 책임: 오늘 투찰 화면과 로딩 화면이 함께 쓰는 배치(제목·머리 문장·기준 줄·하한선 자리 입구 줄·품목 줄·본문)를 소유한다. */
import type { ReactNode } from 'react';

export function WorkFrame({
  lede,
  stamp,
  filters,
  entry = null,
  children
}: {
  readonly lede: ReactNode;
  readonly stamp: ReactNode;
  readonly filters: ReactNode;
  /** 하한선 자리로 가는 한 줄이다(EAT-356). 따로 조회해 늦게 와도 목록을 막지 않게 호출자가 Suspense로 감싼다. */
  readonly entry?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section data-slot='work-screen' aria-labelledby='work-title' className='mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8'>
      <h1 id='work-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>오늘 투찰</h1>
      <div className='mt-2.5 text-[17px] font-semibold text-muted-foreground'>{lede}</div>
      <div className='mt-2 text-[13px] text-muted-foreground'>{stamp}</div>
      {entry === null ? null : <div className='mt-3'>{entry}</div>}
      {filters}
      {children}
    </section>
  );
}
