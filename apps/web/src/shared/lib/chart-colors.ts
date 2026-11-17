/** @module 책임: 기존 차트·지도와 공고 분석이 공유하는 밝게·어둡게 캔버스 색상 팔레트를 한 곳에서 제공한다. */
/**
 * 차트 색 단일화 — DESIGN.md D-1
 * CSS 변수를 못 읽는 캔버스 라이브러리(ECharts·leaflet)용 hex는 여기서만 정의한다.
 * SVG 자작 차트는 계속 var(--primary) 등 토큰을 쓴다.
 * 다크/라이트는 getter가 접근 시점에 분기한다 — 새 hex를 화면 코드에 쓰지 않는다.
 */
export function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/**
 * 판정 색 + 프레임 — 라이트 기준값 / 다크 보정값.
 * 낙찰 계열은 브랜드 파랑이다. 색 테마가 하나로 줄며(#240) 테마별 갈래와 옛 초록 팔레트를 걷었다.
 * 이 파일의 글자값은 색 글자값 검사의 옛 위반 목록에 있다 — 쓰는 화면(/floor·/auctions)을 지울 때 함께 사라진다.
 */
const LIGHT = {
  win: '#3182f6',
  second: '#9a6b22',
  invalid: '#8b5a5a',
  floor: '#e5484d',
  band: 'rgba(49,130,246,0.3)',
  me: '#7659c5',
  own: '#c74bd6',
  volume: 'rgba(141,161,187,0.4)'
} as const;
const DARK = {
  win: '#76adff',
  second: '#dbb36e',
  invalid: '#b08585',
  floor: '#f16a67',
  band: 'rgba(118,173,255,0.3)',
  me: '#bda5ff',
  own: '#e6a0f0',
  volume: 'rgba(141,161,187,0.5)'
} as const;

const currentPalette = () => (isDark() ? DARK : LIGHT);

export const CHART = {
  /** 낙찰 계열은 브랜드 파랑이다. */
  get win() {
    return currentPalette().win;
  },
  /** 밀림·2등가(앰버 = --chart-3) */
  get second() {
    return currentPalette().second;
  },
  /** 무효·실효하한(회갈) */
  get invalid() {
    return isDark() ? DARK.invalid : LIGHT.invalid;
  },
  /** 하한선(인주 적 = --destructive) */
  get floor() {
    return isDark() ? DARK.floor : LIGHT.floor;
  },
  /** 잘 나온 구간 음영 */
  get band() {
    return currentPalette().band;
  },
  /** 사용자 값은 낙찰 계열과 구별되는 강조색을 쓴다. */
  get me() {
    return currentPalette().me;
  },
  /** 실제 제출 점. 사용자 가정 `me`(파랑)·낙찰 `win`과 색이 겹치면 가정과 사실이 같은 색으로 읽힌다. */
  get own() {
    return currentPalette().own;
  },
  /** 참여 수 볼륨 */
  get volume() {
    return currentPalette().volume;
  },
  /** 하한선 자리(PDR-0009)의 공고별 하한선 점. 그림의 주인공이라 브랜드 파랑을 쓴다. */
  get floorPoint() {
    return currentPalette().win;
  },
  /** 하한선 자리의 실제 투찰 1~10등 점. 하한선 점 뒤로 물러나는 중립 회색이다. */
  get ladder() {
    return isDark() ? '#7d8590' : '#8b95a1';
  }
};

/** 내 투찰 마커 — 다크에서 #111이 사라지는 문제 대응 */
export function myMarker(): string {
  return isDark() ? '#e8ece9' : '#111111';
}

/** 캔버스 그림(ECharts)의 축 글자·테두리 */
export function chartFrame() {
  const dark = isDark();
  return { text: dark ? '#a5b1c2' : '#536176', border: dark ? '#353b45' : '#e5e8ec' };
}

/** 지도 타일 — 다크는 Esri Dark Gray Canvas (OSM 라이트 타일이 다크 화면을 찢는 문제.
 *  CARTO dark_matter는 API 키 워터마크가 떠서 제외) */
export function mapTiles() {
  return isDark()
    ? {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors'
      }
    : {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap'
      };
}
