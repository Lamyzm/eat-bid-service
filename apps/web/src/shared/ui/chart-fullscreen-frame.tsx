/** @module 책임: 차트의 전체보기 크기와 공통 셸에 보내는 공간 점유 신호를 소유하고 업무 상태·모달 동작은 호출자에 둔다. */
import type { ComponentProps } from 'react';

import { cn } from '@/shared/lib/cn';

type Props = ComponentProps<'div'> & {
  readonly active: boolean;
  readonly surface: 'workspace' | 'overlay';
};

// workspace는 같은 DOM 자리를 유지해 캔버스·줌을 보존한다. overlay의 초점과 배경 차단은
// Base UI Dialog가 소유하며, 이 프레임은 Popup의 render 대상으로도 사용할 수 있다.
export function ChartFullscreenFrame({ active, surface, className, ...props }: Props) {
  return (
    <div
      {...props}
      data-chart-fullscreen={active || undefined}
      data-workspace-fullscreen={active && surface === 'workspace' ? true : undefined}
      className={cn(
        className,
        active && 'h-dvh min-h-0 w-full min-w-0 max-w-none rounded-none',
        active && surface === 'overlay' && 'fixed inset-0'
      )}
    />
  );
}
