/** @module 책임: legacy dashboard 본문이 request 시점에 도착하기 전 같은 자리를 채우는 skeleton을 소유한다. */
import { Skeleton } from '@/shared/ui/skeleton';

/** legacy 화면은 제목·설명·카드 격자 순서를 공유하므로 같은 순서로 자리만 잡는다. */
export function DashboardScreenSkeleton() {
  return (
    <div
      role='status'
      aria-label='대시보드를 불러오는 중'
      aria-busy='true'
      className='grid gap-4 p-4'
    >
      <span className='sr-only'>대시보드를 불러오는 중</span>
      <Skeleton className='h-8 w-56' />
      <Skeleton className='h-4 w-80' />
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className='h-28 w-full' />
        ))}
      </div>
    </div>
  );
}
