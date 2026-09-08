/** @module 책임: 공고 화면의 선택 context 안에서 현재 공고·과거 기록과 진입 도구를 전역 슬롯에 전달한다. */
'use client';
import type { ReactNode } from 'react';
import { DockSlot } from '@/shared/ui/workspace-dock-slots';
import { ResponsiveDock } from '@/shared/ui/responsive-dock';
import { useAttemptSelection } from './attempt-selection';
import { AuctionRosterPanel } from './auction-roster-panel';
import { DecisionTools } from './decision-tools';

export function AuctionWorkspaceDock({ fallback }: { readonly fallback: ReactNode }) {
  const { row, panel, close, returnFocus } = useAttemptSelection();
  return (
    <>
      <DockSlot slot='panel'>
        <ResponsiveDock
          open={panel !== null}
          title={panel === 'record' ? '선택 회차 기록' : '현재 공고 정보'}
          onClose={close}
          returnFocus={returnFocus}
        >
          <div hidden={panel !== 'current'}>{fallback}</div>
          {row && panel === 'record' ? (
            <AuctionRosterPanel
              key={row.attemptId}
              row={row}
              onClose={close}
              showCloseButton={false}
            />
          ) : null}
        </ResponsiveDock>
      </DockSlot>
      <DockSlot slot='rail'>
        <DecisionTools placement='rail' />
      </DockSlot>
      <DockSlot slot='header'>
        <DecisionTools placement='top' />
      </DockSlot>
    </>
  );
}
