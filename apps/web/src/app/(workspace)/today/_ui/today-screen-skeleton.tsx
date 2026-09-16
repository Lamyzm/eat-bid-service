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
          /* 제목 → 머리 문장 → 기준 줄. 실제 머리와 같은 세 줄이라 로딩이 끝나도 목록이 아래로 밀리지 않는다. */
          <div className='grid gap-2.5'>
            <h1 id='today-title' className='sr-only'>
              열린 공고를 불러오는 중
            </h1>
            <Skeleton className='h-8 w-16' />
            <Skeleton className='h-6 w-full max-w-xl' />
            <Skeleton className='h-4 w-64' />
          </div>
        }
        rail={
          /* 프리셋 → 지역 → 품목 → 기초금액. 실제 기둥과 같은 순서라 로딩이 끝나도 자리가 움직이지 않는다. */
          <div className='grid gap-5'>
            {Array.from({ length: 3 }, (_, group) => (
              <div key={group} className='grid gap-1.5'>
                <Skeleton className='h-4 w-12' />
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className='h-8 w-full rounded-lg' />
                ))}
              </div>
            ))}
            <Skeleton className='h-10 w-full rounded-lg' />
          </div>
        }
        filters={
          /* 달력 → 검색. 축 줄과 탭 줄은 없다(EAT-241·EAT-260). */
          <div className='grid gap-2.5'>
            <Skeleton className='h-28 w-full max-w-2xl rounded-lg' />
            <Skeleton className='h-11 w-full rounded-xl' />
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
