'use client';
/**
 * @module 책임: 폰 폭에서 한 행의 다른 방법 칸들을 접고 펼치는 손잡이를 소유한다. 넓은 화면에서는 손잡이가 숨고 칸이 행 격자에 그대로
 * 선다(`display: contents`) — 칸의 열 자리는 부모가 준 `order`가 정한다.
 */
import { useId, useState, type ReactNode } from 'react';

export function PhoneFold({ count, children }: { readonly count: number; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className='w-fit text-[13px] font-bold text-primary hover:underline sm:hidden'
      >
        {open ? '다른 방법 접기' : `다른 방법 ${count}개 보기`}
      </button>
      <div id={id} data-slot='bid-board-fold' className={`${open ? 'grid gap-2' : 'hidden'} sm:contents`}>
        {children}
      </div>
    </>
  );
}
