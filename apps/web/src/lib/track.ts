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

/**
 * 액션 이벤트 — G1 교차검증용 meta 포함
 * mark_* 는 {bidNo, rate, from} 를 남긴다. rate 는 사용자가 저장한 값 그대로(반올림·절삭 금지) —
 * 개찰 후 firm_bids 의 실제 투찰률과 대조하는 것이 목적이라 값이 바뀌면 쓸모가 없다.
 */
export type ActionName =
  | 'basket_add'
  | 'mark_done'    // 저장
  | 'mark_update'  // 갱신
  | 'mark_undone'  // 해제
  | 'calc_input'
  | 'open_empty';  // 내 자격 지역 공고 0건 화면

export type ActionMeta = {
  bidNo?: string;
  rate?: number;                                  // 그대로 (소수 3~4자리 유지)
  from?: 'today' | 'auction' | 'analysis';        // 값 저장 유입 경로
  regions?: number;                               // open_empty: 자격 지역 수
};

export function trackAction(name: ActionName, meta?: ActionMeta) {
  try {
    const m: ActionMeta = {};
    if (meta?.bidNo) m.bidNo = String(meta.bidNo).slice(0, 32);
    if (typeof meta?.rate === 'number' && Number.isFinite(meta.rate)) m.rate = meta.rate;
    if (meta?.from) m.from = meta.from;
    if (typeof meta?.regions === 'number') m.regions = meta.regions;
    queue.push({ session: sid(), screen: name, ...(Object.keys(m).length ? { meta: m } : {}) });
    if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 5000);
  } catch {}
}

/** 세션(브라우저 탭)당 1회만 기록 — calc_input 등 */
export function trackOnce(name: ActionName, meta?: ActionMeta, key?: string) {
  try {
    const k = `eatbid.evt.${name}${key ? `.${key}` : ''}`;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
    trackAction(name, meta);
  } catch {}
}

/** 오늘 날짜(로컬) — open_empty 를 하루 1회로 묶는 키 */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 화면 진입 1회 기록 */
export function useTrack(screen: string) {
  useEffect(() => { track(screen); }, [screen]);
}
