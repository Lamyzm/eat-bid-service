/** @module 책임: 오늘 투찰 화면과 같은 배치로 로딩 중 자리를 잡는다. 실제 화면과 같은 frame과 구역 순서를 쓴다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { WorkFrame } from './work-frame';

export function WorkScreenSkeleton() {
  return (
    <WorkFrame
      lede={<Skeleton className='h-6 w-72' />}
      stamp={<Skeleton className='h-4 w-96 max-w-full' />}
      filters={
        <>
          <Skeleton className='mt-4 h-9 w-full max-w-xl' />
          <Skeleton className='mt-4 h-8 w-80 max-w-full' />
        </>
      }
    >
      <div className='mt-6 grid gap-4' aria-hidden>
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className='h-[92px] w-full rounded-xl' />)}
      </div>
    </WorkFrame>
  );
}
