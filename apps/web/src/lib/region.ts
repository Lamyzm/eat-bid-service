'use client';
/**
 * 지역 모델 — 자격 지역은 집합(사업자별 소재지 1~N), 보는 지역은 전역 스위처 하나
 * 자격: localStorage eatbid.regions (온보딩·설정에서만 변경)
 * 보기: sessionStorage eatbid.viewRegion — 'home'(자격 집합) | 특정 시군구. 세션 한정.
 * 전역 공유: 커스텀 이벤트로 모든 구독 컴포넌트 동기화
 */
import { useEffect, useState, useCallback } from 'react';

const HOMES_KEY = 'eatbid.regions';
const LEGACY_KEY = 'eatbid.region';
const VIEW_KEY = 'eatbid.viewRegion';
const EVT = 'eatbid:region';

function readHomes(): string[] {
  try {
    const raw = localStorage.getItem(HOMES_KEY);
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy ? [legacy] : [];
  } catch { return []; }
}
function readView(): string {
  try { return sessionStorage.getItem(VIEW_KEY) ?? 'home'; } catch { return 'home'; }
}

export function useRegion() {
  const [homes, setHomesState] = useState<string[]>([]);
  const [view, setViewState] = useState<string>('home'); // 'home' | sigungu
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setHomesState(readHomes());
    setViewState(readView());
    setReady(true);
    const on = () => { setHomesState(readHomes()); setViewState(readView()); };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const setHomes = useCallback((rs: string[]) => {
    try { localStorage.setItem(HOMES_KEY, JSON.stringify(rs)); } catch {}
    window.dispatchEvent(new Event(EVT));
  }, []);
  const toggleHome = useCallback((r: string) => {
    const cur = readHomes();
    setHomes(cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]);
  }, [setHomes]);
  const setView = useCallback((r: string) => {
    try { sessionStorage.setItem(VIEW_KEY, r); } catch {}
    window.dispatchEvent(new Event(EVT));
  }, []);

  /** 현재 보기 기준 시군구 목록 — 'home'이면 자격 집합, 자격 미설정이면 null(전체) */
  const viewRegions = view === 'home' ? (homes.length ? homes : null) : [view];
  const isBrowsing = view !== 'home';

  return { homes, view, viewRegions, isBrowsing, setHomes, toggleHome, setView, ready };
}
