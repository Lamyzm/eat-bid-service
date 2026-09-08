/** @module 책임: 실제 결정 화면과 동일한 DecisionFrame geometry를 쓰는 최초 route loading skeleton을 렌더링한다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { DecisionFrame } from './decision-frame';

function CardSkeleton({ lines }: { readonly lines: number }) {
  return (
    <div className='grid gap-2 rounded-xl bg-card p-4 shadow-xs'>
      <Skeleton className='h-5 w-24' />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className='h-4 w-full max-w-sm' />
      ))}
    </div>
  );
}

/** route 로딩 중에도 실제 결정 화면과 같은 frame과 section 순서를 유지한다. */
export function DecisionScreenSkeleton() {
  return (
    <div role='status' aria-label='공고 정보를 불러오는 중' aria-busy='true'>
      <span className='sr-only'>공고 정보를 불러오는 중</span>
      <DecisionFrame
        header={
          <div className='flex items-center gap-3'>
            <h1 id='decision-title' className='sr-only'>
              공고 정보를 불러오는 중
            </h1>
            <Skeleton className='h-7 w-64' />
            <Skeleton className='ml-auto h-8 w-24' />
          </div>
        }
        banner={<Skeleton className='h-20 w-full rounded-xl' />}
        filters={<Skeleton className='h-10 w-full max-w-lg' />}
        evidence={
          <div className='grid gap-4'>
            {/* 근거 탭 카드는 탭 줄·안내문·본문 세 켜다. 실제 높이를 비워 두면 도착 순간 화면이 밀린다. */}
            <div className='grid gap-3 rounded-xl bg-card p-4 shadow-xs'>
              <Skeleton className='h-10 w-72' />
              <Skeleton className='h-4 w-80' />
              <Skeleton className='h-60 w-full' />
            </div>
            <CardSkeleton lines={1} />
          </div>
        }
        history={
          <div className='grid gap-2 rounded-xl bg-card p-4 shadow-xs'>
            <Skeleton className='h-5 w-24' />
            <Skeleton className='h-[520px] w-full' />
          </div>
        }
        rail={<Skeleton className='h-96 w-full rounded-xl' />}
      />
    </div>
  );
}
