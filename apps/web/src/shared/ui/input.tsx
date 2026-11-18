/** @module 책임: 사용자가 값을 직접 적는 공통 Input 표면의 크기(48px·17px)·상태 시각과 접근성 기본값을 소유한다. */
import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/shared/lib/cn';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot='input'
      className={cn(
        'h-12 w-full min-w-0 rounded-control border border-input bg-card px-4 text-body transition-colors outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-label file:font-bold file:text-foreground placeholder:text-ink-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        className
      )}
      {...props}
    />
  );
}

export { Input };
