/** @module 책임: reduced-motion을 존중하는 공통 loading skeleton primitive를 제공한다. */
import { cn } from '@/shared/lib/cn';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden='true'
      data-slot='skeleton'
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
