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
        evidence={
          <div className='grid gap-4'>
            <CardSkeleton lines={2} />
            {/* 흐름 SVG와 과거 회차 표는 실제 높이가 커서 2~3줄 카드로 두면 도착 순간 화면이 밀린다. */}
            <div className='grid gap-2 rounded-xl bg-card p-4 shadow-xs'>
              <Skeleton className='h-5 w-24' />
              <Skeleton className='h-60 w-full' />
            </div>
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
