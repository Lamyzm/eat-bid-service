'use client';
import { useEffect, useState, useCallback } from 'react';

const KEY = 'eatbid.bizNos';

/** 브라우저 워크스페이스 — 등록한 사업자번호 목록 (인증 도입 전 MVP) */
export function useWorkspace() {
  const [bizNos, setBizNos] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setBizNos(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  const save = useCallback((next: string[]) => {
    setBizNos(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }, []);

  const add = useCallback((bz: string) => {
    const clean = bz.replace(/-/g, '').trim();
    if (!clean) return;
    save([...new Set([...bizNos, clean])]);
  }, [bizNos, save]);

  const remove = useCallback((bz: string) => {
    save(bizNos.filter(b => b !== bz));
  }, [bizNos, save]);

  return { bizNos, add, remove, ready };
}
