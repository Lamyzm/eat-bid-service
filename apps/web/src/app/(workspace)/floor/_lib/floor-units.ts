/**
 * @module 책임: 하한선 자리 화면이 숫자와 이름을 말하는 방식(기초금액 대비 %, eaT에 넣는 사정률, 1억 공고의 원 금액, 달·기관 이름)을 한 곳에서 정한다.
 *
 * 눈금은 기초금액 대비 %이고 사정률과 원 단위를 이름 붙여 함께 적는다(PDR-0009 결정 4). 이 화면은 하한율 90% 공고만 보이므로
 * 사정률은 기초금액 대비 % ÷ 0.9다. 하한율을 고르게 되면 이 상수가 아니라 응답 meta의 하한율로 바꾼다.
 */

/** 화면이 조회하는 하한율이다. 계약은 소수 세 자리 투찰률 문자열을 받는다. */
export const FLOOR_RATE_TEXT = '90.000';
const FLOOR_RATIO = 0.9;

/** 기초금액 대비 %를 eaT에 넣는 사정률로 바꾼다. */
export function assessmentRate(basePercent: number): number {
  return basePercent / FLOOR_RATIO;
}

/** 사정률을 기초금액 대비 %로 바꾼다. */
export function basePercentOf(assessment: number): number {
  return assessment * FLOOR_RATIO;
}

export function rateText(basePercent: number, digits: number): string {
  return assessmentRate(basePercent).toFixed(digits);
}

/** `8,941만`처럼 만 원 단위로 반올림한다. */
export function manText(won: number): string {
  return `${Math.round(won / 10_000).toLocaleString('ko-KR')}만`;
}

/** 기초금액 1억 공고에서 이 %가 몇 원인지다. 화면 % 표기(소수 둘째 자리)와 같은 값으로 셈해 문장과 금액이 어긋나지 않게 한다. */
export function per100MillionText(basePercent: number): string {
  return `${manText((100_000_000 * Number(basePercent.toFixed(2))) / 100)} 원`;
}

/** `3만 2천 원`처럼 천 원 단위까지 말한다. 하한선과 넣은 값의 차이처럼 작은 금액에 쓴다. */
export function manCheonText(won: number): string {
  const rounded = Math.round(Math.abs(won) / 1_000) * 1_000;
  if (rounded === 0) return '1천 원 아래';
  const man = Math.floor(rounded / 10_000);
  const cheon = (rounded % 10_000) / 1_000;
  return `${[man > 0 ? `${man.toLocaleString('ko-KR')}만` : '', cheon > 0 ? `${cheon}천` : ''].filter(Boolean).join(' ')} 원`;
}

export function countText(count: number): string {
  return count.toLocaleString('ko-KR');
}

/** `2026-09` → `26년 9월` */
export function monthLabel(month: string): string {
  return `${month.slice(2, 4)}년 ${Number(month.slice(5, 7))}월`;
}

/** `2026-09` → `9` */
export function monthNumber(month: string): number {
  return Number(month.slice(5, 7));
}

/** `10번 중 1.2번`처럼 비율을 열 번에 몇 번으로 말한다. 퍼센트보다 사장님이 바로 읽는다(2026-10-14 통화). */
export function tenthsText(ratio: number): string {
  return `10번 중 ${(10 * ratio).toFixed(1).replace(/\.0$/, '')}번`;
}

/** 점이 가리키는 기관 이름이다. 관측되지 않은 이름은 지어내지 않는다(AGENTS 3). */
export function organizationLabel(organizations: readonly string[], index: number | null): string {
  return index === null ? '기관 이름 없음' : (organizations[index] ?? '기관 이름 없음');
}
