/** @module 책임: 복기 화면과 같은 배치로 로딩 중 자리를 잡는다. 실제 화면과 같은 frame과 구역 순서를 쓴다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { ReviewFrame } from './review-frame';

export function ReviewScreenSkeleton() {
  return (
    <ReviewFrame lede={<Skeleton className='h-6 w-80 max-w-full' />} stamp={<Skeleton className='h-4 w-96 max-w-full' />}>
      <div className='mt-5 grid gap-3' aria-hidden>
        <Skeleton className='h-8 w-60' />
        <Skeleton className='h-9 w-full max-w-2xl' />
        <Skeleton className='mt-3 h-56 w-full rounded-xl' />
        {[0, 1, 2].map((index) => <Skeleton key={index} className='h-36 w-full rounded-xl' />)}
      </div>
    </ReviewFrame>
  );
}
