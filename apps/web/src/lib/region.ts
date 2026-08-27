'use client';
/**
 * 지역 모델 — 두 얼굴 (스펙: IA 재편 릴레이 리뷰)
 * 자격 지역: localStorage eatbid.region — 사업자 소재지 기반, 온보딩에서 선택
 * 보는 지역: sessionStorage eatbid.viewRegion — 구경용, 세션 한정 (낡은 컨텍스트 방지)
 */
import { useEffect, useState, useCallback } from 'react';

const HOME_KEY = 'eatbid.region';
const VIEW_KEY = 'eatbid.viewRegion';

export function useRegion() {
  const [home, setHomeState] = useState<string | null>(null);
  const [view, setViewState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const h = localStorage.getItem(HOME_KEY);
      setHomeState(h);
      setViewState(sessionStorage.getItem(VIEW_KEY) ?? h);
    } catch {}
    setReady(true);
  }, []);

  const setHome = useCallback((r: string | null) => {
    setHomeState(r);
    try { r ? localStorage.setItem(HOME_KEY, r) : localStorage.removeItem(HOME_KEY); } catch {}
  }, []);
  const setView = useCallback((r: string | null) => {
    setViewState(r);
    try { r ? sessionStorage.setItem(VIEW_KEY, r) : sessionStorage.removeItem(VIEW_KEY); } catch {}
  }, []);

  return { home, view, setHome, setView, ready };
}
