/** @module 책임: 상태 label과 함께 사용할 수 있는 공통 진행 spinner primitive를 제공한다. */
import { IconLoader } from '@tabler/icons-react';

import { cn } from '@/shared/lib/cn';

export function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <IconLoader
      data-slot='spinner'
      role='status'
      aria-label='처리 중'
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
