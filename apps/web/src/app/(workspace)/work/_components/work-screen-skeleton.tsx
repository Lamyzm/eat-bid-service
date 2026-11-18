/**
 * @module 책임: 넣을 공고를 처음 여는 동안 실제 화면과 같은 자리(마감일 칩·목록 판·이달 값 판)를 잡는다. 값이 들어와도 배치가 밀리지
 * 않도록 칸 높이와 배치 규칙을 실제 화면(`WorkBoard`)과 같게 둔다.
 */
import { Skeleton } from '@/shared/ui/skeleton';

import { WorkFrame } from './work-frame';

const CHIPS = [0, 1, 2, 3, 4];
const ROWS = [0, 1, 2, 3, 4, 5];

export function WorkScreenSkeleton() {
  return (
    <WorkFrame stamp={<Skeleton className='h-5 w-48' />}>
      <div className='@container min-w-0' aria-hidden>
        <div className='flex flex-col gap-4 @3xl:flex-row @3xl:items-start @3xl:gap-6'>
          <div className='grid min-w-0 flex-1 content-start gap-4'>
            <div className='flex gap-2 overflow-hidden pb-0.5'>
              {CHIPS.map((index) => (
                <Skeleton key={index} className='h-16 w-28 shrink-0 rounded-control' />
              ))}
            </div>
            <div className='grid gap-1 rounded-panel bg-card px-6 py-4'>
              <Skeleton className='mb-2 h-6 w-28' />
              {ROWS.map((index) => (
                <Skeleton key={index} className='my-3.5 h-8 w-full' />
              ))}
            </div>
          </div>
          <div className='order-first @3xl:order-none @3xl:w-60 @3xl:shrink-0 @5xl:w-70'>
            <div className='grid gap-3 rounded-panel bg-card px-5 py-5.5'>
              <Skeleton className='h-6 w-36' />
              <Skeleton className='h-14 w-full' />
              <Skeleton className='h-14 w-full' />
            </div>
          </div>
        </div>
      </div>
    </WorkFrame>
  );
}
