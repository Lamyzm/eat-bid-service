/**
 * @module 책임: 화면에 보이는 숫자 표기(세 자리 쉼표·원·건·%)의 유일한 주인이다. 같은 숫자가 화면마다 다른 꼴로 보이지 않게
 * 쉼표를 넣는 곳을 여기 하나로 모으고, `toLocaleString`·`Intl.NumberFormat`은 architecture:check가 이 파일 밖에서 막는다(#240).
 *
 * 금액과 비율은 계약에서 십진 문자열로 오므로 문자열 그대로 다룬다. Number로 바꾸면 큰 금액과 소수 셋째 자리가 흔들린다(AGENTS 15).
 * 값의 뜻(기초금액 대비 %인지)은 부르는 쪽이 이름으로 붙이고, 여기서는 꼴만 맞춘다.
 */

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

/** "1234567" → "1,234,567". 소수부와 부호는 그대로 둔다. 숫자가 아닌 글은 손대지 않고 돌려준다. */
export function groupDigits(value: string | number | bigint): string {
  const text = String(value);
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (match === null) return text;
  const [, sign = '', whole = '', fraction = ''] = match;
  return `${sign}${whole.replace(GROUPING, ',')}${fraction}`;
}

/** 건수: 3 → "3건". */
export function formatCount(count: number, unit = '건'): string {
  return `${groupDigits(count)}${unit}`;
}

/** 원 금액: "7761885" → "7,761,885원". */
export function formatWon(amount: string | bigint): string {
  return `${groupDigits(amount)}원`;
}

/** 비율: "89.685" → "89.685%". 자릿수는 계약이 정한 그대로 둔다. */
export function formatPercent(value: string): string {
  return `${value}%`;
}
