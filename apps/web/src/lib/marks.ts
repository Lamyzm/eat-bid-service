'use client';
import { useEffect, useState, useCallback } from 'react';

/** 공고 표시 — 관심/투찰함(+쓴 투찰률). 인증 도입 전 브라우저 저장 MVP */
export type Mark = { s: 'watch' | 'done'; rate?: number };
const KEY = 'eatbid.marks';

export function useMarks() {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  useEffect(() => {
    try { const r = localStorage.getItem(KEY); if (r) setMarks(JSON.parse(r)); } catch {}
  }, []);
  const set = useCallback((bidNo: string, m: Mark | null) => {
    setMarks(prev => {
      const next = { ...prev };
      if (m) next[bidNo] = m; else delete next[bidNo];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return { marks, set };
}
