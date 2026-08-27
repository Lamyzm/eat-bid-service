'use client';
/**
 * 화면 열람 이벤트 — 상업성 게이트 측정용 (TEAM-KICKOFF §A)
 * 익명 세션(eatbid.sid) · 5초 debounce 배치 · sendBeacon 우선 · 실패 무시(fire-and-forget)
 * 계약: POST /api/events {rows:[{session≤64, screen≤40, meta?}]} ≤50행
 */
import { useEffect } from 'react';

const SID_KEY = 'eatbid.sid';
type Row = { session: string; screen: string; meta?: object };

let queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let unloadHooked = false;

function sid(): string {
  try {
    let s = localStorage.getItem(SID_KEY);
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem(SID_KEY, s);
    }
    return s.slice(0, 64);
  } catch {
    return 'anon';
  }
}

function flush() {
  if (queue.length === 0) return;
  const rows = queue.splice(0, 50);
  const body = JSON.stringify({ rows });
  try {
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function track(screen: string, meta?: object) {
  try {
    if (!unloadHooked) {
      unloadHooked = true;
      addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
    queue.push({ session: sid(), screen: screen.slice(0, 40), meta: { path: location.pathname, ...meta } });
    if (queue.length >= 50) {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
      return;
    }
    if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 5000);
  } catch {}
}

/** 익명 세션 키 조회 (share 발급 등 계약상 session이 필요한 곳) */
export function getSid(): string { return sid(); }

/** 액션 이벤트 — meta 없이 액션명만 (값·공고번호 저장 금지 규칙) */
export function trackAction(name: 'basket_add' | 'basket_save' | 'share_create') {
  try {
    queue.push({ session: sid(), screen: name });
    if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 5000);
  } catch {}
}

/** 화면 진입 1회 기록 */
export function useTrack(screen: string) {
  useEffect(() => { track(screen); }, [screen]);
}
