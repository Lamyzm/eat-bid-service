import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { DockSlotHost, DockSlotsProvider } from '@/shared/ui/workspace-dock-slots';

// 근거 탭의 흐름↔분포 전환은 주소의 `view`를 shallow로 고친다. 제품에서는 route의 nuqs adapter가 그 자리를
// 맡으므로 검사에서도 같은 자리에 대역 adapter를 둔다(`hasMemory`라야 클릭이 실제로 값을 바꾼다).
export function WorkspaceDockFixture({ children }: { children: ReactNode }) {
  return (
    <NuqsTestingAdapter hasMemory>
      <DockSlotsProvider>
        <header>
          <DockSlotHost slot='header' />
        </header>
        <div data-slot='workspace-page'>{children}</div>
        <DockSlotHost slot='panel' />
        <DockSlotHost slot='rail' />
      </DockSlotsProvider>
    </NuqsTestingAdapter>
  );
}
