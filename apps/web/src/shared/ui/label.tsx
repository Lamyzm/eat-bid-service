/** @module 책임: 입력과 짝을 이루는 공통 Label 표면의 시각과 비활성 상태 전달을 소유한다. */
'use client';

import * as React from 'react';

import { cn } from '@/shared/lib/cn';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor/children arrive via props at each call site
    <label
      data-slot='label'
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Label };
