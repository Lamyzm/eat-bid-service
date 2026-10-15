/** @module 책임: 하한선 자리와 같은 배치로 로딩 중 자리를 잡는다. 실제 화면과 같은 frame과 구역 순서를 쓴다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { FloorFrame } from './floor-frame';

export function FloorScreenSkeleton() {
  return (
    <FloorFrame
      bar={
        <div className='flex flex-wrap gap-3' aria-hidden>
          <Skeleton className='h-11 w-36' />
          <Skeleton className='h-11 w-48' />
          <Skeleton className='h-11 w-72 max-w-full' />
        </div>
      }
    >
      <div className='grid gap-3' aria-hidden>
        <Skeleton className='h-5 w-80 max-w-full' />
        <Skeleton className='h-7 w-full max-w-3xl' />
        <Skeleton className='h-5 w-full max-w-2xl' />
        <Skeleton className='mt-3 h-11 w-96 max-w-full' />
        <Skeleton className='h-[480px] w-full rounded-2xl sm:h-[560px]' />
      </div>
    </FloorFrame>
  );
}
