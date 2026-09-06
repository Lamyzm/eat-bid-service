/** @module 책임: 과거 회차 표가 실제로 그릴 회차 창(표본 수·표시 행 수)을 정수 값 객체로 정하고 그 창을 사람이 읽는 부제 문구로 옮긴다. */

/**
 * 표가 그리는 최대 행 수다. 부제의 "최근 N회 표시"와 표가 같은 상한을 써야 문구와 표가 어긋나지
 * 않는다. 이 상수는 서버 컴포넌트(부제)와 client 컴포넌트(표)가 함께 읽으므로 `'use client'`가 없는
 * 이 모듈이 소유한다. `'use client'` 모듈에 두면 서버 쪽 import가 client reference로 바뀌어
 * 숫자가 아니게 되고, 산술 결과가 NaN으로 화면에 나간다(EAT-77).
 */
export const HISTORY_WINDOW_LIMIT = 12;

/**
 * 표본 수는 기관의 전체 회차, 표시 수는 상한에 걸린 뒤 실제로 그릴 행 수다. 둘은 의미가 다르므로
 * 하나의 숫자로 합치지 않는다(AGENTS 15).
 */
export type HistoryWindow = {
  readonly sampleCount: number;
  readonly shownCount: number;
};

// 계약 밖 값(NaN, 음수, 소수)이 들어와도 화면에 NaN을 내보내지 않는다. 구조적 원인은 상수 소유를
// 옮겨 막았지만, 부제는 사실을 말하는 자리라 셀 수 없는 입력은 0으로 떨어뜨려 "표시 없음"이 되게 한다.
function countable(value: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

export function historyWindow(sampleCount: number, rowCount: number): HistoryWindow {
  return {
    sampleCount: countable(sampleCount),
    shownCount: Math.min(countable(rowCount), HISTORY_WINDOW_LIMIT)
  };
}

/**
 * 그릴 행이 없으면 "최근 0회 표시"가 아니라 표시할 회차가 없다고 말한다. 0회 표시는 숫자를 세었다는
 * 뜻이 되어, 아직 회차를 못 받은 기관과 회차가 실제로 없는 기관을 같은 문구로 덮는다.
 */
export function historyWindowText(window: HistoryWindow): string {
  if (window.shownCount === 0) return `${window.sampleCount}회 · 최근 표시 없음`;
  return `${window.sampleCount}회 · 최근 ${window.shownCount}회 표시`;
}
