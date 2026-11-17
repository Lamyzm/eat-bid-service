/**
 * @module 책임: 한 화면의 바깥 틀(이름 붙은 폭·왼쪽 붙임·여백)과 머리(제목·기준 시각)를 소유한다. 화면과 그 뼈대(loading)가 같은
 * 틀을 써야 불러오는 동안과 다 불러온 뒤의 칸이 같은 자리에 선다(#240). 화면은 폭·가운데 정렬을 손으로 고르지 않는다.
 */
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

type PageFrameProps = {
  /** 화면 제목(`PageHeader`의 `id`)을 가리킨다. 틀이 그 제목으로 읽힌다. */
  readonly labelledBy: string;
  readonly children: ReactNode;
  /** 화면을 가르는 data-slot 이름이다. e2e와 화면 대조가 이 이름으로 화면을 찾는다. */
  readonly slot?: string;
  readonly className?: string;
};

/** 본문은 가운데가 아니라 왼쪽에 붙고 `max-w-page`에서 멈춘다. 넓은 창에서 오른쪽이 남는 것은 의도다. */
export function PageFrame({ labelledBy, children, slot, className }: PageFrameProps) {
  return (
    <section
      data-slot={slot ?? 'page-frame'}
      aria-labelledby={labelledBy}
      className={cn(
        'grid w-full max-w-page min-w-0 content-start gap-8 px-4 pt-8 pb-16 sm:px-8 lg:px-12 lg:pt-10',
        className
      )}
    >
      {children}
    </section>
  );
}

type PageHeaderProps = {
  readonly id: string;
  readonly title: ReactNode;
  /** 제목 오른쪽의 짧은 보조 글(기준 시각 등)이다. 불러오는 동안에는 같은 자리에 뼈대를 넣는다. */
  readonly aside?: ReactNode;
};

export function PageHeader({ id, title, aside }: PageHeaderProps) {
  return (
    <div
      data-slot='page-header'
      className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'
    >
      <h1 id={id} className='text-title font-extrabold tracking-tight'>
        {title}
      </h1>
      {aside === undefined || aside === null ? null : (
        <div className='text-label font-semibold text-ink-3 tabular-nums'>{aside}</div>
      )}
    </div>
  );
}
