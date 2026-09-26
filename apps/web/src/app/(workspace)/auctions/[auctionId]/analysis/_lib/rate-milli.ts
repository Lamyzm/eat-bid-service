/**
 * @module 책임: 계약의 사정률 고정 십진 문자열(소수 셋째 자리)과 화면이 좌표·비교에 쓰는 milli 정수를 오간다.
 *
 * 추이와 선택 회차 명단이 같은 규칙을 써야 같은 값이 두 곳에서 다르게 반올림되지 않는다. 부동소수를
 * 거치면 90.005 같은 칸 경계가 흔들리므로 문자열을 정수 자리로 바로 옮긴다.
 */
const RATE_SCALE = 1000;

/** `90.005` → 90005. 계약과 다른 모양이면 조용히 0으로 두지 않고 멈춘다. */
export function rateMilli(text: string): number {
  const match = /^(-?)([0-9]+)\.([0-9]{3})$/.exec(text);
  if (match === null) throw new RangeError(`사정률 문자열의 형태가 계약과 다릅니다: ${text}`);
  const magnitude = Number(match[2]) * RATE_SCALE + Number(match[3]);
  return match[1] === '-' ? -magnitude : magnitude;
}

/** 90005 → `90.005`. */
export function rateText(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const magnitude = Math.abs(milli);
  return `${sign}${Math.floor(magnitude / RATE_SCALE)}.${String(magnitude % RATE_SCALE).padStart(3, '0')}`;
}
