/**
 * @module 책임: 분포 조회의 달력 경계인 KST 달 값과 그 이동·거리·SQL 표현을 소유한다.
 *
 * 달은 시각이 아니라 달력 구간이다. `Instant`나 `Date`로 나르면 어느 시간대의 달인지가 값에서
 * 사라지고, 일반 문자열로 나르면 `2026-1`과 `2026-10`의 정렬이 무너진다(AGENTS 15).
 */
import { Temporal } from "@eatbid/domain";

declare const kstMonthBrand: unique symbol;

export type KstMonth = string & { readonly [kstMonthBrand]: "KstMonth" };

const KST_MONTH_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const KST_TIME_ZONE = "Asia/Seoul";

export function kstMonth(value: string): KstMonth {
  if (!KST_MONTH_PATTERN.test(value)) throw new RangeError(`KST month must be YYYY-MM but was ${value}`);
  return value as KstMonth;
}

/** 개찰 시각이 속한 KST 달이다. 낙찰은 개찰의 결과이므로 공고가 아니라 개찰이 속한 달에 센다. */
export function kstMonthOf(instant: Temporal.Instant): KstMonth {
  const zoned = instant.toZonedDateTimeISO(KST_TIME_ZONE);
  return kstMonth(`${zoned.year.toString().padStart(4, "0")}-${zoned.month.toString().padStart(2, "0")}`);
}

function ordinalOf(month: KstMonth): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function fromOrdinal(ordinal: number): KstMonth {
  const year = Math.floor(ordinal / 12);
  const monthOfYear = ordinal % 12 + 1;
  return kstMonth(`${year.toString().padStart(4, "0")}-${monthOfYear.toString().padStart(2, "0")}`);
}

export function shiftKstMonth(month: KstMonth, months: number): KstMonth {
  return fromOrdinal(ordinalOf(month) + months);
}

/** 양끝을 포함한 달 수다. 같은 달이면 1이고 뒤집힌 구간이면 0 이하가 된다. */
export function kstMonthSpan(from: KstMonth, to: KstMonth): number {
  return ordinalOf(to) - ordinalOf(from) + 1;
}

export function kstMonthsBetween(from: KstMonth, to: KstMonth): KstMonth[] {
  const months: KstMonth[] = [];
  for (let ordinal = ordinalOf(from); ordinal <= ordinalOf(to); ordinal += 1) months.push(fromOrdinal(ordinal));
  return months;
}

/** mart의 `month_kst`는 그 달 1일 `date`다. 조회 술어가 쓰는 표현을 여기 한 곳이 만든다. */
export function kstMonthFirstDayText(month: KstMonth): string {
  return `${month}-01`;
}
