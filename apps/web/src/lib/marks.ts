'use client';
import { useCallback } from 'react';
import { useSession, setMarks, type Mark } from '@/lib/session';

export type { Mark };

/** 공고 표시 — 관심/투찰 저장(+쓴 투찰률). 게스트=로컬, 로그인=서버 동기화 */
export function useMarks() {
  const { marks } = useSession();
  const set = useCallback((bidNo: string, m: Mark | null) => {
    const next = { ...marks };
    if (m) next[bidNo] = m; else delete next[bidNo];
    setMarks(next);
  }, [marks]);
  return { marks, set };
}
