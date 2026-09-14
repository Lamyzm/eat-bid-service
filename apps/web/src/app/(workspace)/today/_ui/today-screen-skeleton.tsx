/** @module 책임: 실제 오늘 화면과 동일한 TodayFrame geometry와 표 머리글 구조를 쓰는 최초 route loading skeleton을 렌더링한다. */
import { Skeleton } from '@/shared/ui/skeleton';

import { TodayFrame } from './today-frame';

/** route 로딩 중에도 실제 오늘 화면과 같은 frame·section 순서·표 열 구조를 유지한다(screen-system §8). */
export function TodayScreenSkeleton() {
  return (
    <div role='status' aria-label='열린 공고를 불러오는 중' aria-busy='true'>
      <span className='sr-only'>열린 공고를 불러오는 중</span>
      <TodayFrame
        header={
          <div className='flex items-center gap-3'>
            <h1 id='today-title' className='sr-only'>
              열린 공고를 불러오는 중
            </h1>
            <Skeleton className='h-7 w-24' />
            <Skeleton className='h-5 w-48' />
            <Skeleton className='ml-auto h-5 w-24' />
          </div>
        }
        rail={
          <div className='grid gap-2'>
            <Skeleton className='h-5 w-40' />
            <Skeleton className='h-7 w-28 rounded-lg' />
            <Skeleton className='h-4 w-36' />
          </div>
        }
        filters={
          <div className='grid gap-3'>
            <div className='flex flex-wrap gap-2'>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className='h-9 w-28 rounded-lg' />
              ))}
            </div>
            <Skeleton className='h-24 w-full max-w-2xl rounded-lg' />
          </div>
        }
        list={
          <div className='grid gap-3 rounded-xl bg-card p-4 shadow-xs'>
            <Skeleton className='h-5 w-32' />
            <div className='grid gap-2'>
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className='h-11 w-full' />
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
