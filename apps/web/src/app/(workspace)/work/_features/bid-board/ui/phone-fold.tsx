'use client';
/**
 * @module 책임: 폰 폭에서 한 행의 다른 방법 칸들을 접고 펼치는 손잡이를 소유한다. 넓은 화면에서는 손잡이가 숨고 칸이 행 격자에 그대로
 * 선다(`display: contents`) — 칸의 열 자리는 부모가 준 `order`가 정한다.
 */
import { useId, useState, type ReactNode } from 'react';

/** `label`은 펼치기 전 손잡이 이름이다. 접힌 칸이 하나면 그 방법 이름을 넣어 바로 아래 "더 보기"와 헷갈리지 않게 한다. */
export function PhoneFold({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className='flex w-fit items-baseline gap-1 text-[13px] font-bold text-primary hover:underline sm:hidden'
      >
        <span aria-hidden='true' className='text-[10px]'>{open ? '▼' : '▶'}</span>
        {open ? '다른 방법 접기' : label}
      </button>
      <div id={id} data-slot='bid-board-fold' className={`${open ? 'grid gap-2' : 'hidden'} sm:contents`}>
        {children}
      </div>
    </>
  );
}
