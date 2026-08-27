'use client';
/**
 * 차트 색 단일화 — DESIGN.md D-1
 * CSS 변수를 못 읽는 캔버스 라이브러리(lightweight-charts·leaflet)용 hex는 여기서만 정의한다.
 * SVG 자작 차트는 계속 var(--primary) 등 토큰을 쓴다.
 */
export const CHART = {
  /** 낙찰(관인 녹색 = --primary) */
  win: '#149a80',
  /** 밀림·2등가(앰버 = --chart-3) */
  second: '#e8a13a',
  /** 무효·실효하한(회갈) */
  invalid: '#8b5a5a',
  /** 하한선(인주 적 = --destructive) */
  floor: '#e5484d',
  /** 잘 나온 구간 음영 */
  band: 'rgba(20,154,128,0.55)',
  /** 나(내 값·기회) — 코발트 */
  me: '#2962ff',
  /** 참여 수 볼륨 */
  volume: 'rgba(120,130,125,0.45)',
} as const;

export function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** 내 투찰 마커 — 다크에서 #111이 사라지는 문제 대응 */
export function myMarker(): string {
  return isDark() ? '#e8ece9' : '#111111';
}

/** lightweight-charts 축·테두리 (테마별) */
export function chartFrame() {
  const dark = isDark();
  return { text: dark ? '#9aa5a0' : '#6b7570', border: dark ? '#3a423e' : '#d7ddd9' };
}

/** 시장 지도 버블 — 기대낙찰(연 공고 ÷ 업체) 단계색 */
export function bubbleColor(expWin: number | null): string {
  if (expWin == null) return '#9aa5a0';
  if (expWin >= 30) return '#0e7a63';
  if (expWin >= 15) return '#149a80';
  if (expWin >= 7) return '#5bb8a4';
  return '#a8cfc5';
}
