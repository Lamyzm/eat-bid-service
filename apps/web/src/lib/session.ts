'use client';
/**
 * 세션·계정 데이터 단일 소스 (Better Auth 배선)
 * - 게스트: localStorage가 진실
 * - 로그인: 서버가 진실 (쓰기는 로컬에도 남기고 PUT 동기화 — 실패해도 로컬 생존)
 * - 훅 3개(useWorkspace/useRegion/useMarks)가 이 스토어를 useSyncExternalStore로 구독
 */
import { useSyncExternalStore } from 'react';

export type Mark = { s: 'watch' | 'done'; rate?: number };
export type Me = {
  ok: boolean;
  guest: boolean;
  user: { id: string; email?: string | null; name?: string | null } | null;
  googleEnabled?: boolean;
};

const K = {
  biz: 'eatbid.bizNos',
  regions: 'eatbid.regions',
  legacyRegion: 'eatbid.region',
  marks: 'eatbid.marks',
  merged: 'eatbid.mergedFor',
} as const;

type State = {
  ready: boolean;
  guest: boolean;
  user: Me['user'];
  googleEnabled: boolean;
  bizNos: string[];
  regions: string[];
  marks: Record<string, Mark>;
};

let state: State = {
  ready: false, guest: true, user: null, googleEnabled: false,
  bizNos: [], regions: [], marks: {},
};
const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }
function setState(patch: Partial<State>) { state = { ...state, ...patch }; emit(); }

function readLocal(): Pick<State, 'bizNos' | 'regions' | 'marks'> {
  const out = { bizNos: [] as string[], regions: [] as string[], marks: {} as Record<string, Mark> };
  try {
    const b = localStorage.getItem(K.biz); if (b) out.bizNos = JSON.parse(b);
    const r = localStorage.getItem(K.regions);
    if (r) out.regions = JSON.parse(r);
    else { const legacy = localStorage.getItem(K.legacyRegion); if (legacy) out.regions = [legacy]; }
    const m = localStorage.getItem(K.marks); if (m) out.marks = JSON.parse(m);
  } catch {}
  return out;
}
function writeLocal(patch: Partial<Pick<State, 'bizNos' | 'regions' | 'marks'>>) {
  try {
    if (patch.bizNos) localStorage.setItem(K.biz, JSON.stringify(patch.bizNos));
    if (patch.regions) localStorage.setItem(K.regions, JSON.stringify(patch.regions));
    if (patch.marks) localStorage.setItem(K.marks, JSON.stringify(patch.marks));
  } catch {}
}

const api = (path: string, init?: RequestInit) =>
  fetch(path, { credentials: 'include', ...init });

async function put(path: string, body: unknown) {
  if (state.guest) return;
  try {
    await api(path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
}

let booted = false;
/** 앱 부팅 시 1회 — /api/me 조회 후 게스트/로그인 소스 확정, 최초 로그인이면 병합 PUT */
export async function boot() {
  if (booted) return;
  booted = true;
  const local = readLocal();
  setState({ ...local }); // 서버 응답 전에도 로컬로 즉시 동작
  let me: any = null;
  try { me = await api('/api/me').then(r => r.json()); } catch {}
  if (!me || me.guest !== false) {
    setState({ ready: true, guest: true, user: null, googleEnabled: !!me?.googleEnabled, ...local });
    return;
  }
  const serverBiz: string[] = me.bizNos ?? [];
  const serverRegions: string[] = me.regions ?? [];
  const serverMarks: Record<string, Mark> = me.marks ?? {};

  // 최초 로그인 병합 — 로컬 ∪ 서버, 사용자당 1회
  let mergedBiz = serverBiz, mergedRegions = serverRegions, mergedMarks = serverMarks;
  let needMerge = false;
  try { needMerge = localStorage.getItem(K.merged) !== me.user?.id; } catch {}
  if (needMerge) {
    mergedBiz = [...new Set([...local.bizNos, ...serverBiz])];
    mergedRegions = [...new Set([...local.regions, ...serverRegions])];
    mergedMarks = { ...local.marks, ...serverMarks }; // 서버 우선
  }
  setState({
    ready: true, guest: false, user: me.user ?? null, googleEnabled: !!me.googleEnabled,
    bizNos: mergedBiz, regions: mergedRegions, marks: mergedMarks,
  });
  writeLocal({ bizNos: mergedBiz, regions: mergedRegions, marks: mergedMarks }); // 로컬은 캐시로 유지
  if (needMerge) {
    try { localStorage.setItem(K.merged, me.user?.id ?? '1'); } catch {}
    await Promise.all([
      put('/api/me/biz', { bizNos: mergedBiz }),
      put('/api/me/regions', { regions: mergedRegions }),
      put('/api/me/marks', { marks: mergedMarks }),
    ]);
  }
}

// ── 쓰기 API (로컬 즉시 + 로그인 시 PUT 동기화) ──
export function setBizNos(next: string[]) {
  setState({ bizNos: next });
  writeLocal({ bizNos: next });
  void put('/api/me/biz', { bizNos: next });
}
export function setRegions(next: string[]) {
  setState({ regions: next });
  writeLocal({ regions: next });
  void put('/api/me/regions', { regions: next });
}
export function setMarks(next: Record<string, Mark>) {
  setState({ marks: next });
  writeLocal({ marks: next });
  void put('/api/me/marks', { marks: next });
}

// ── 구독 ──
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return state; }
const serverSnapshot: State = {
  ready: false, guest: true, user: null, googleEnabled: false,
  bizNos: [], regions: [], marks: {},
};
function getServerSnapshot() { return serverSnapshot; }

export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
