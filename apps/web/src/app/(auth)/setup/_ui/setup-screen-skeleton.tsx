/** @module 책임: 설정 화면과 같은 frame·section 순서를 가진 최초 route loading 표시를 제공한다. */
import { Skeleton } from '@/shared/ui/skeleton';

export function SetupScreenSkeleton() {
  return (
    <div className='mx-auto grid w-full max-w-2xl gap-4 px-3 py-6 sm:px-4'>
      <Skeleton className='h-7 w-40' />
      <Skeleton className='h-32 w-full' />
      <Skeleton className='h-40 w-full' />
    </div>
  );
}
