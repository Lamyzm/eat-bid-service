'use client';
/**
 * 지역 모델 — 자격 지역은 집합(사업자별 소재지 1~N), 보는 지역은 전역 스위처 하나
 * 자격: 세션 스토어(게스트=localStorage, 로그인=서버)
 * 보기: sessionStorage eatbid.viewRegion — 'home' | 특정 시군구. 세션 한정.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession, setRegions } from '@/lib/session';

const VIEW_KEY = 'eatbid.viewRegion';
const EVT = 'eatbid:viewRegion';

function readView(): string {
  try { return sessionStorage.getItem(VIEW_KEY) ?? 'home'; } catch { return 'home'; }
}

export function useRegion() {
  const { regions: homes, ready } = useSession();
  const [view, setViewState] = useState<string>('home');

  useEffect(() => {
    setViewState(readView());
    const on = () => setViewState(readView());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const setHomes = useCallback((rs: string[]) => setRegions(rs), []);
  const toggleHome = useCallback((r: string) => {
    setRegions(homes.includes(r) ? homes.filter(x => x !== r) : [...homes, r]);
  }, [homes]);
  const setView = useCallback((r: string) => {
    try { sessionStorage.setItem(VIEW_KEY, r); } catch {}
    window.dispatchEvent(new Event(EVT));
  }, []);

  const viewRegions = view === 'home' ? (homes.length ? homes : null) : [view];
  const isBrowsing = view !== 'home';

  return { homes, view, viewRegions, isBrowsing, setHomes, toggleHome, setView, ready };
}
