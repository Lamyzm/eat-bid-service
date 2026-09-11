/**
 * @module 책임: "몰리는 날"의 단위인 KST 달력일 값과 그 형식 검증을 소유한다.
 *
 * 하루는 시각이 아니라 달력 구간이다. `Instant`로 나르면 어느 시간대의 하루인지가 값에서 사라지고,
 * 일반 문자열로 나르면 마감이 몰린 날짜와 아무 문자열이 같은 타입이 된다(AGENTS 15).
 */
declare const kstDateBrand: unique symbol;

export type KstDate = string & { readonly [kstDateBrand]: "KstDate" };

const KST_DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;

export function kstDate(value: string): KstDate {
  if (!KST_DATE_PATTERN.test(value)) throw new RangeError(`KST date must be YYYY-MM-DD but was ${value}`);
  return value as KstDate;
}
