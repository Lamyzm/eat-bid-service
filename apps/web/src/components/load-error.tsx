'use client';
import { Button } from '@/components/ui/button';

/**
 * 조회 실패 고지 — 빈 상태와 구분해서 보여준다.
 * "없습니다"와 "못 받았습니다"는 다른 사실이다.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className='flex flex-wrap items-center justify-center gap-3 py-8 text-center text-sm'>
      <span className='text-destructive font-medium'>{message}</span>
      {onRetry && <Button size='sm' variant='outline' onClick={onRetry}>다시 시도</Button>}
    </div>
  );
}
