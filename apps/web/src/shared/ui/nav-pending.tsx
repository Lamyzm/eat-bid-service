/**
 * @module 책임: 누른 메뉴 링크 안에서 다음 화면을 기다리는 동안만 작은 도는 표시를 그린다. 150ms 안에 끝나는 이동에서는 보이지
 * 않아 깜박이지 않는다(#240). 표시 시점은 CSS `nav-pending`이, 대기 여부는 Next `useLinkStatus`가 소유한다.
 */
'use client';

import { useLinkStatus } from 'next/link';

import { cn } from '@/shared/lib/cn';

/** Next `<Link>`의 자손으로만 둔다. 링크 밖에서는 대기 상태를 알 수 없다. */
export function NavPending({ className }: { readonly className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      data-slot='nav-pending'
      aria-hidden
      className={cn(
        'nav-pending ml-auto size-4 shrink-0 rounded-full border-2 border-line border-t-brand',
        className
      )}
    />
  );
}
