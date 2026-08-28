'use client';
/**
 * 차트 색 단일화 — DESIGN.md D-1
 * CSS 변수를 못 읽는 캔버스 라이브러리(lightweight-charts·leaflet)용 hex는 여기서만 정의한다.
 * SVG 자작 차트는 계속 var(--primary) 등 토큰을 쓴다.
 * 다크/라이트는 getter가 접근 시점에 분기한다 — 새 hex를 화면 코드에 쓰지 않는다.
 */
export function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** 판정 4색 + 프레임 — 라이트 기준값 / 다크 보정값 */
const LIGHT = {
  win: '#149a80',
  second: '#e8a13a',
  invalid: '#8b5a5a',
  floor: '#e5484d',
  band: 'rgba(20,154,128,0.55)',
  me: '#2962ff',
  volume: 'rgba(120,130,125,0.45)',
} as const;
const DARK = {
  win: '#4cc2a4',
  second: '#d9a75e',
  invalid: '#b08585',
  floor: '#f16a67',
  band: 'rgba(76,194,164,0.55)',
  me: '#6f9bff',
  volume: 'rgba(150,160,155,0.45)',
} as const;

export const CHART = {
  /** 낙찰(관인 녹색 = --primary) */
  get win() { return isDark() ? DARK.win : LIGHT.win; },
  /** 밀림·2등가(앰버 = --chart-3) */
  get second() { return isDark() ? DARK.second : LIGHT.second; },
  /** 무효·실효하한(회갈) */
  get invalid() { return isDark() ? DARK.invalid : LIGHT.invalid; },
  /** 하한선(인주 적 = --destructive) */
  get floor() { return isDark() ? DARK.floor : LIGHT.floor; },
  /** 잘 나온 구간 음영 */
  get band() { return isDark() ? DARK.band : LIGHT.band; },
  /** 나(내 값·기회) — 코발트 */
  get me() { return isDark() ? DARK.me : LIGHT.me; },
  /** 참여 수 볼륨 */
  get volume() { return isDark() ? DARK.volume : LIGHT.volume; },
};

/** 내 투찰 마커 — 다크에서 #111이 사라지는 문제 대응 */
export function myMarker(): string {
  return isDark() ? '#e8ece9' : '#111111';
}

/** lightweight-charts 축·테두리 (테마별) */
export function chartFrame() {
  const dark = isDark();
  return { text: dark ? '#9aa5a0' : '#6b7570', border: dark ? '#3a423e' : '#d7ddd9' };
}

/** 시장 지도 버블 — 기대낙찰(연 공고 ÷ 업체) 단계색 (다크는 밝은 램프) */
const BUBBLE_LIGHT = ['#a8cfc5', '#5bb8a4', '#149a80', '#0e7a63'] as const;
const BUBBLE_DARK = ['#3d6a5f', '#3f9e88', '#4cc2a4', '#7adfc6'] as const;
export function bubbleColor(expWin: number | null): string {
  const ramp = isDark() ? BUBBLE_DARK : BUBBLE_LIGHT;
  if (expWin == null) return isDark() ? '#5a655f' : '#9aa5a0';
  if (expWin >= 30) return ramp[3];
  if (expWin >= 15) return ramp[2];
  if (expWin >= 7) return ramp[1];
  return ramp[0];
}

/** 지도 타일 — 다크는 CARTO dark_matter (OSM 라이트 타일이 다크 화면을 찢는 문제) */
export function mapTiles() {
  return isDark()
    ? {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }
    : {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap',
      };
}
