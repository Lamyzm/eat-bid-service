/** @module 책임: 오늘 화면이 KST 시각·남은 날·금액·하한율을 사람이 읽는 문자열로 적는 규칙 하나를 소유한다. 표시 모델 조립과 달리 이 규칙은 목록·요약·마감 묶음이 함께 쓴다. */
import { Temporal } from '@eatbid/domain';

const KST = 'Asia/Seoul';
const pad2 = (value: number): string => value.toString().padStart(2, '0');

/** wire instant를 KST `MM-DD HH:mm`으로. `Temporal.ZonedDateTimeISO` 필드를 직접 읽으므로 ambient `Date`나
 * 로케일 구현체별 Intl 자정 표기 차이에 기대지 않는다(`present-decision.ts`의 `kst()`와 같은 방식). */
export function kstDateTime(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.month)}-${pad2(zoned.day)} ${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

export function kstTime(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

export function kstDate(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.month)}-${pad2(zoned.day)}`;
}

// D-day는 관측이 아니라 보는 시점에 대한 표현이라 계약이 아니라 화면이 계산한다. KST 달력일 차이다.
export function dDayOf(closesAt: string, nowIso: string): number {
  const closes = Temporal.Instant.from(closesAt).toZonedDateTimeISO(KST).toPlainDate();
  const today = Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST).toPlainDate();
  return today.until(closes, { largestUnit: 'days' }).days;
}

/**
 * 남은 날을 한국어 날짜 세는 말로 적는다. `D-3`은 눈금이지 말이 아니라서 `사흘 뒤`보다 늦게 읽힌다.
 * 열흘을 넘으면 세는 말이 오히려 낯설어져 숫자로 돌아간다.
 */
const DAY_AWAY = ['오늘', '내일', '모레', '사흘 뒤', '나흘 뒤', '닷새 뒤', '엿새 뒤', '이레 뒤', '여드레 뒤', '아흐레 뒤', '열흘 뒤'] as const;

export function dayAwayText(dDay: number): string {
  if (dDay <= 0) return DAY_AWAY[0];
  return DAY_AWAY[dDay] ?? `${dDay}일 뒤`;
}

function formatWon(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// wire 소수부가 0이면 볼 이유가 없는 정밀도라 생략하고, 0이 아니면 관측된 값 그대로 보인다(반올림하지 않는다).
export function formatAmountText(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  return paddedFraction === '00' ? formatWon(whole) : `${formatWon(whole)}.${paddedFraction}`;
}

/**
 * 저장된 하한율은 `90.000` 꼴이라 소수부의 0은 볼 이유가 없는 정밀도다. 관측된 자릿수가 의미를 갖는
 * 경우(`88.500`)는 그대로 남기고 뒤따르는 0만 뗀다. 반올림하지 않는다.
 *
 * 행과 요약이 같은 문자열을 만들어야 `드문 하한` 집합이 행에 붙는다. 그래서 이 함수 하나가 두 곳의
 * 표기를 소유한다.
 */
export function formatFloorRate(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** 하한율을 관측하지 못한 행이 쓰는 표시값이다. 0이나 90으로 채우면 화면이 없는 사실을 말한다(AGENTS 3). */
export const FLOOR_RATE_UNKNOWN = '미확인';
