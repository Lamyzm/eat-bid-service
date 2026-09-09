import type { ReactNode } from 'react';
import { DockSlotHost, DockSlotsProvider } from '@/shared/ui/workspace-dock-slots';

export function WorkspaceDockFixture({ children }: { children: ReactNode }) {
  return (
    <DockSlotsProvider>
      <header>
        <DockSlotHost slot='header' />
      </header>
      <div data-slot='workspace-page'>{children}</div>
      <DockSlotHost slot='panel' />
      <DockSlotHost slot='rail' />
    </DockSlotsProvider>
  );
}
