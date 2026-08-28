'use client';
/**
 * 세션·계정 데이터 단일 소스 (Better Auth 배선)
 * - 게스트: localStorage가 진실
 * - 로그인: 서버가 진실 (쓰기는 로컬에도 남기고 PUT 동기화 — 실패해도 로컬 생존)
 * - 훅 3개(useWorkspace/useRegion/useMarks)가 이 스토어를 useSyncExternalStore로 구독
 */
import { useSyncExternalStore } from 'react';

export type Mark = { s: 'watch' | 'done'; rate?: number; rates?: Record<string, number> };
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
  marksBackup: 'eatbid.marks.unreadable',
  pendingSync: 'eatbid.pendingSync',
} as const;

type State = {
  ready: boolean;
  /** 이전 저장분을 읽지 못했다 (사본은 MARKS_BACKUP_KEY 에 보존) */
  marksUnreadable: boolean;
  /** 서버 동기화 실패 — 로컬에는 저장돼 있다. unauthorized 면 재로그인이 필요하다 */
  syncError: { unauthorized: boolean } | null;
  guest: boolean;
  user: Me['user'];
  googleEnabled: boolean;
  bizNos: string[];
  /** 사업자번호 → 상호. 화면마다 다른 라벨을 쓰지 않도록 여기서 한 번만 받는다 */
  bizNames: Record<string, string>;
  regions: string[];
  marks: Record<string, Mark>;
};

let state: State = {
  ready: false, marksUnreadable: false, syncError: null, guest: true, user: null, googleEnabled: false,
  bizNos: [], bizNames: {}, regions: [], marks: {},
};
const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }
function setState(patch: Partial<State>) { state = { ...state, ...patch }; emit(); }

/**
 * marks 를 읽을 수 없으면(구버전·손상·수동 편집) 원본 사본을 따로 남기고, 새 저장은 정상 진행한다.
 * 지금 치고 있는 값을 못 쓰게 막는 쪽이 더 나쁘다. 읽지 못한 사실은 화면에 알린다.
 */
let marksUnreadable = false;
export function wasMarksUnreadable() { return marksUnreadable; }
/** 읽지 못한 원본 사본이 남아 있는 키 */
export const MARKS_BACKUP_KEY = 'eatbid.marks.unreadable';

function readLocal(): Pick<State, 'bizNos' | 'regions' | 'marks'> {
  const out = { bizNos: [] as string[], regions: [] as string[], marks: {} as Record<string, Mark> };
  try {
    const b = localStorage.getItem(K.biz); if (b) out.bizNos = JSON.parse(b);
  } catch {}
  try {
    const r = localStorage.getItem(K.regions);
    if (r) out.regions = JSON.parse(r);
    else { const legacy = localStorage.getItem(K.legacyRegion); if (legacy) out.regions = [legacy]; }
  } catch {}
  try {
    const m = localStorage.getItem(K.marks);
    if (m) {
      const parsed = JSON.parse(m);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.marks = parsed;
      else throw new Error('unexpected marks shape');
    }
  } catch {
    marksUnreadable = true;
    // 읽지 못한 원본은 사본으로 보존한다 (덮어쓰기 전에 반드시 먼저)
    try {
      const raw = localStorage.getItem(K.marks);
      if (raw && !localStorage.getItem(K.marksBackup)) localStorage.setItem(K.marksBackup, raw);
    } catch {}
    out.marks = {};
  }
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

/**
 * 서버 저장 — 실패를 삼키지 않는다.
 * 로컬 저장은 이미 끝난 상태라 값은 남아 있다. 실패 사실만 정확히 알린다.
 */
async function put(path: string, body: unknown): Promise<boolean> {
  if (state.guest) return true;
  try {
    const res = await api(path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 서버는 실패도 200 으로 주는 경로가 있다 — 본문의 ok 까지 본다
    let ok = res.ok;
    if (ok) {
      try { ok = (await res.clone().json())?.ok !== false; } catch {}
    }
    if (!ok) {
      markSyncFailed(res.status === 401);
      return false;
    }
    clearSyncFailed();
    return true;
  } catch {
    markSyncFailed(false); // 네트워크 단절 등
    return false;
  }
}

function markSyncFailed(unauthorized: boolean) {
  try { localStorage.setItem(K.pendingSync, '1'); } catch {}
  setState({ syncError: { unauthorized } });
}
function clearSyncFailed() {
  try { localStorage.removeItem(K.pendingSync); } catch {}
  if (state.syncError) setState({ syncError: null });
}

/** 못 올린 값이 남아 있으면 다시 올린다 (재로그인·재접속 후 자동 복구) */
export async function retrySync(): Promise<boolean> {
  if (state.guest) return false;
  const results = await Promise.all([
    put('/api/me/biz', { bizNos: state.bizNos }),
    put('/api/me/regions', { regions: state.regions }),
    put('/api/me/marks', { marks: state.marks }),
  ]);
  return results.every(Boolean);
}

/**
 * 회차별 병합 — 서버 엔트리로 통째 덮으면 로컬의 둘째 사업자 값(rates)이 사라진다.
 * 로그인할 때마다 값이 지워지던 사고가 여기서 났다.
 */
export function mergeMarks(
  localMarks: Record<string, Mark>,
  serverMarks: Record<string, Mark>,
): Record<string, Mark> {
  const out: Record<string, Mark> = { ...localMarks };
  for (const [bidNo, sv] of Object.entries(serverMarks)) {
    const lo = localMarks[bidNo];
    const loHasRates = lo?.rates != null && Object.keys(lo.rates).length > 0;
    out[bidNo] = loHasRates
      ? { ...sv, ...lo }            // 로컬의 사업자별 값을 우선 보존
      : { ...(lo ?? {}), ...sv };   // 그 외에는 서버 우선
  }
  return out;
}

let booted = false;
/** 앱 부팅 시 1회 — /api/me 조회 후 게스트/로그인 소스 확정, 최초 로그인이면 병합 PUT */
export async function boot() {
  if (booted) return;
  booted = true;
  const local = readLocal();
  setState({ ...local, marksUnreadable }); // 서버 응답 전에도 로컬로 즉시 동작
  let me: any = null;
  try { me = await api('/api/me').then(r => r.json()); } catch {}
  if (!me || me.guest !== false) {
    setState({ ready: true, guest: true, user: null, googleEnabled: !!me?.googleEnabled, ...local, marksUnreadable });
    loadBizNames(local.bizNos);
    return;
  }
  const serverBiz: string[] = me.bizNos ?? [];
  const serverRegions: string[] = me.regions ?? [];
  const serverMarks: Record<string, Mark> = me.marks ?? {};

  // 최초 로그인 병합 — 로컬 ∪ 서버, 사용자당 1회
  let mergedBiz = serverBiz, mergedRegions = serverRegions, mergedMarks = serverMarks;
  // id 가 없으면 병합하지 않는다 — 공용 PC 에서 다른 계정 데이터가 섞이는 경로다 (X6)
  const userId: string | null = me.user?.id ?? null;
  let needMerge = false;
  try { needMerge = userId != null && localStorage.getItem(K.merged) !== userId; } catch {}
  if (needMerge) {
    mergedBiz = [...new Set([...local.bizNos, ...serverBiz])];
    mergedRegions = [...new Set([...local.regions, ...serverRegions])];
    mergedMarks = mergeMarks(local.marks, serverMarks);
  }
  setState({
    ready: true, guest: false, user: me.user ?? null, googleEnabled: !!me.googleEnabled,
    bizNos: mergedBiz, regions: mergedRegions, marks: mergedMarks, marksUnreadable,
  });
  writeLocal({ bizNos: mergedBiz, regions: mergedRegions, marks: mergedMarks }); // 로컬은 캐시로 유지
  loadBizNames(mergedBiz);
  let pending = false;
  try { pending = localStorage.getItem(K.pendingSync) === '1'; } catch {}
  if (needMerge || pending) {
    // 병합분이거나, 지난번에 못 올린 값이 남아 있으면 다시 올린다
    try { if (userId) localStorage.setItem(K.merged, userId); } catch {}
    const results = await Promise.all([
      put('/api/me/biz', { bizNos: mergedBiz }),
      put('/api/me/regions', { regions: mergedRegions }),
      put('/api/me/marks', { marks: mergedMarks }),
    ]);
    if (results.every(Boolean)) clearSyncFailed();
  }
}

/** 상호 조회 — 이미 받은 번호는 다시 묻지 않는다 */
function loadBizNames(bizNos: string[]) {
  for (const bz of bizNos) {
    if (state.bizNames[bz]) continue;
    api(`/api/firms/lookup?bizNo=${bz}`).then(r => r.json())
      .then(d => { if (d?.name) setState({ bizNames: { ...state.bizNames, [bz]: d.name } }); })
      .catch(() => {});
  }
}

// ── 쓰기 API (로컬 즉시 + 로그인 시 PUT 동기화) ──
export function setBizNos(next: string[]) {
  setState({ bizNos: next });
  loadBizNames(next);
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

/** 이 브라우저에 남은 기록 삭제 (공용 PC 대비 — U24) */
export function clearLocalData() {
  try {
    localStorage.removeItem(K.biz);
    localStorage.removeItem(K.regions);
    localStorage.removeItem(K.legacyRegion);
    localStorage.removeItem(K.marks);
    localStorage.removeItem(K.merged);
    sessionStorage.removeItem('eatbid.viewRegion');
  } catch {}
  setState({ bizNos: [], regions: [], marks: {} });
}

// ── 구독 ──
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return state; }
const serverSnapshot: State = {
  ready: false, marksUnreadable: false, syncError: null, guest: true, user: null, googleEnabled: false,
  bizNos: [], bizNames: {}, regions: [], marks: {},
};
function getServerSnapshot() { return serverSnapshot; }

export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
