'use client';
import { useCallback } from 'react';
import { useSession, setBizNos } from '@/lib/session';

/** 워크스페이스 — 등록한 사업자번호 (게스트=로컬, 로그인=서버 동기화) */
export function useWorkspace() {
  const { bizNos, ready } = useSession();
  const add = useCallback((bz: string) => {
    const clean = bz.replace(/-/g, '').trim();
    if (!clean) return;
    setBizNos([...new Set([...bizNos, clean])]);
  }, [bizNos]);
  const remove = useCallback((bz: string) => {
    setBizNos(bizNos.filter(b => b !== bz));
  }, [bizNos]);
  return { bizNos, add, remove, ready };
}
