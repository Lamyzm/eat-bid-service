/** @module 책임: 넣을 공고 화면과 같은 배치로 로딩 중 자리를 잡는다. 실제 화면과 같은 frame과 구역 순서(값 카드·마감일 묶음)를 쓴다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { WorkFrame } from './work-frame';

export function WorkScreenSkeleton() {
  return (
    <WorkFrame stamp={<Skeleton className='h-5 w-40' />}>
      <div
        className='grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]'
        aria-hidden
      >
        {[0, 1].map((index) => (
          <Skeleton key={index} className='h-38 w-full rounded-panel' />
        ))}
      </div>
      <div className='grid gap-3' aria-hidden>
        <Skeleton className='h-7 w-48' />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className='h-14 w-full rounded-panel' />
        ))}
      </div>
    </WorkFrame>
  );
}
