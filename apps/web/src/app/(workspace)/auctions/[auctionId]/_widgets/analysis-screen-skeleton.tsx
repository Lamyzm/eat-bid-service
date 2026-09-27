/** @module 책임: 새 상세의 첫 로딩에서도 실제 지면과 같은 공고·조건·분석·이력 순서를 유지한다. */
import { Skeleton } from '@/shared/ui/skeleton';
import { AnalysisFrame } from './analysis-frame';
export function AnalysisScreenSkeleton() {
  return (
    <AnalysisFrame
      header={
        // 화면 전체가 아직 공고를 읽는 중임을 보조 기술에도 한 이름으로 알린다. 조각마다 status를 달면 여러 번 읽힌다.
        <div role='status' aria-label='공고 정보를 불러오는 중' aria-busy='true' className='grid gap-4'>
          <Skeleton className='h-8 w-60' />
          <Skeleton className='h-4 w-80 max-w-full' />
          <Skeleton className='h-5 w-96 max-w-full' />
        </div>
      }
      toolbar={
        <div aria-busy='true' className='grid gap-4 p-6'>
          <Skeleton className='h-8 w-64' />
          <Skeleton className='h-20 w-full' />
        </div>
      }
      evidence={
        <div className='p-8 text-sm text-muted-foreground'>
          공고 정보를 불러오고 있어요.
        </div>
      }
      history={
        <div className='p-8'>
          <Skeleton className='h-8 w-40' />
        </div>
      }
    />
  );
}
