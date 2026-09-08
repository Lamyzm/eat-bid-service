/** @module 책임: 로그인 화면과 같은 frame·section 순서를 가진 최초 route loading 표시를 제공한다. */
import { Skeleton } from '@/shared/ui/skeleton';

export function LoginScreenSkeleton() {
  return (
    <div className='mx-auto grid w-full max-w-md gap-4 px-3 py-10 sm:px-4'>
      <Skeleton className='h-7 w-32' />
      <Skeleton className='h-4 w-full' />
      <Skeleton className='h-10 w-full' />
    </div>
  );
}
