/** @module 책임: 시장 자리 화면을 읽는 동안 같은 배치로 자리를 잡아 두는 skeleton을 소유한다. */
import { Skeleton } from '@/shared/ui/skeleton';
import { SeatsFrame } from './seats-frame';

export function SeatsScreenSkeleton() {
  return (
    <SeatsFrame form={<Skeleton className='h-[420px] w-full rounded-2xl' />}>
      <div className='grid gap-2' aria-busy='true' aria-label='자리 목록을 불러오는 중'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-14 w-full' />
        <Skeleton className='h-14 w-full' />
      </div>
    </SeatsFrame>
  );
}
