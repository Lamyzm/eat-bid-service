/** @module 책임: 회차 표에서 지금 고른 행이 어느 것인지 보이고 그 회차의 참여 기록 진입을 소유한다. 선택만 브라우저 상태이고 나머지 셀은 서버가 그린다. */
'use client';

import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/button';

import { useAttemptSelection } from './attempt-selection';

/** 표의 한 행. 선택 표시만 브라우저가 정하므로 안의 셀은 서버가 그려 넘긴 것을 그대로 담는다. */
export function HistoryAttemptRow({
  attemptId,
  children
}: {
  readonly attemptId: string;
  readonly children: ReactNode;
}) {
  const { attempt } = useAttemptSelection();
  return (
    <tr
      data-selected={attempt?.attemptId === attemptId ? '' : undefined}
      className='group/row data-selected:bg-primary/5'
    >
      {children}
    </tr>
  );
}

/**
 * 참여 수는 관측 사실이고 기록 열람은 사용자의 행동이다. 숫자 자체를 링크로 두면 무엇이 열리는지
 * 이름이 없어 작은 숫자를 눌러야 알 수 있으므로, 수는 그대로 두고 진입만 이름이 보이는 버튼으로
 * 분리한다. 화면 이름은 짧게 두되 aria-label은 어느 회차인지 말하도록 개찰일을 유지한다(EAT-115).
 */
export function HistoryRecordButton({
  attemptId,
  openedText
}: {
  readonly attemptId: string;
  readonly openedText: string;
}) {
  const { select } = useAttemptSelection();
  return (
    <Button
      variant='link'
      size='sm'
      className='h-auto p-0'
      onClick={() => select(attemptId)}
      aria-label={`${openedText} 회차 참여 기록 보기`}
    >
      기록 보기
    </Button>
  );
}
