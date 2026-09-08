/** @module 책임: 현재 공고의 이력 표와 오른쪽 상세가 선택 회차 ID 하나를 공유하고 조회 범위 밖의 선택을 해제한다. */
'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { HistoryRow } from '../_model/attempt-history';

type AttemptSelection = {
  readonly row: HistoryRow | undefined;
  readonly panel: 'current' | 'record' | null;
  readonly openCurrent: () => void;
  readonly openRecord: () => void;
  readonly returnFocus: () => HTMLElement | null;
  readonly setReturnFocus: (element: HTMLElement | null) => void;
  readonly select: (attemptId: string) => void;
  readonly close: () => void;
};
const Context = createContext<AttemptSelection | null>(null);

export function AttemptSelectionProvider({
  rows,
  children
}: {
  readonly rows: readonly HistoryRow[];
  readonly children: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'current' | 'record' | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // 서버 행을 별도 상태로 복사하지 않는다. 새 조회가 선택 회차를 제외하면 이전 명단을 노출하지 않는다.
  const row = rows.find((candidate) => candidate.attemptId === selectedId);
  // 조건부로 현재 컴포넌트의 선택만 초기화해, 제외 후 다시 포함해도 예전 선택이 되살아나지 않는다.
  if (selectedId !== null && !row) {
    setSelectedId(null);
    if (panel === 'record') setPanel(null);
  }
  const select = useCallback((attemptId: string) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(attemptId);
    setPanel('record');
  }, []);
  const close = useCallback(() => {
    setPanel(null);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  const returnFocus = useCallback(() => trigger.current, []);
  const setReturnFocus = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
  }, []);
  const openCurrent = () => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel('current');
  };
  const openRecord = () => {
    if (!row) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel('record');
  };
  return (
    <Context.Provider
      value={{ row, panel, openCurrent, openRecord, returnFocus, setReturnFocus, select, close }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAttemptSelection(): AttemptSelection {
  const value = useOptionalAttemptSelection();
  if (!value)
    throw new Error('회차 선택은 현재 공고의 AttemptSelectionProvider 안에서 사용해야 합니다.');
  return value;
}

/** 독립 차트 미리보기에는 상세 패널이 없다. 제품 화면에서는 동일 provider의 선택을 사용한다. */
export function useOptionalAttemptSelection(): AttemptSelection | null {
  return useContext(Context);
}
