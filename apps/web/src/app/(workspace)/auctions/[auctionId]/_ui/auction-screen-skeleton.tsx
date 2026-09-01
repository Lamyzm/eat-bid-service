import { Skeleton } from '@/shared/ui/skeleton';

import { AuctionScreenFrame } from './auction-screen-frame';

function SkeletonItems({ count }: { readonly count: number }) {
  return (
    <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className='grid gap-2'>
          <Skeleton className='h-3 w-20' />
          <Skeleton className='h-5 w-full max-w-52' />
        </div>
      ))}
    </div>
  );
}

/** route 로딩 중에도 실제 공고 화면과 같은 frame 및 section 순서를 유지한다. */
export function AuctionScreenSkeleton() {
  return (
    <div role='status' aria-label='공고 정보를 불러오는 중' aria-busy='true'>
      <span className='sr-only'>공고 정보를 불러오는 중</span>
      <AuctionScreenFrame
        header={
          <div className='grid gap-2'>
            <h1 id='auction-title' className='sr-only'>
              공고 정보를 불러오는 중
            </h1>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-9 w-full max-w-xl' />
            <Skeleton className='h-4 w-32' />
          </div>
        }
        summary={
          <div className='rounded-xl border bg-card p-5'>
            <Skeleton className='mb-5 h-5 w-24' />
            <SkeletonItems count={9} />
          </div>
        }
        details={
          <div className='rounded-xl border bg-card p-5'>
            <Skeleton className='mb-5 h-5 w-36' />
            <SkeletonItems count={4} />
          </div>
        }
      />
    </div>
  );
}
