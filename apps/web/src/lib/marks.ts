'use client';
import { useCallback, useMemo } from 'react';
import { useSession, setMarks, type Mark } from '@/lib/session';
import { primaryRate, stripMirror } from '@/lib/mark-rates';

export type { Mark };

/**
 * 공고 표시 — 관심/투찰 저장(회차 × 사업자). 게스트=로컬, 로그인=서버 동기화
 *
 * 저장은 `rates` 전용이다(3단계). 다만 값 1개만 다루는 화면들이 아직 `mark.rate` 를 읽으므로,
 * 훅에서 대표값을 **파생해서** 얹어 준다 — 저장소·서버에는 기록하지 않는다.
 */
export function useMarks() {
  const { marks: raw, bizNos } = useSession();

  const marks = useMemo(() => {
    const out: Record<string, Mark> = {};
    for (const [bidNo, m] of Object.entries(raw)) {
      const rate = primaryRate(m, bizNos);
      out[bidNo] = rate != null ? { ...m, rate } : m;
    }
    return out;
  }, [raw, bizNos]);

  const set = useCallback((bidNo: string, m: Mark | null) => {
    const next = { ...raw };
    if (m) next[bidNo] = stripMirror(m);
    else delete next[bidNo];
    setMarks(next);
  }, [raw]);

  return { marks, set };
}
