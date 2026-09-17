/**
 * @module 책임: "몰리는 날"의 단위인 KST 달력일 값과 그 형식 검증을 소유한다.
 *
 * 하루는 시각이 아니라 달력 구간이다. `Instant`로 나르면 어느 시간대의 하루인지가 값에서 사라지고,
 * 일반 문자열로 나르면 마감이 몰린 날짜와 아무 문자열이 같은 타입이 된다(AGENTS 15).
 */
import { Temporal } from "@eatbid/domain";
import { KST_TIME_ZONE } from "./kst-month";

declare const kstDateBrand: unique symbol;

export type KstDate = string & { readonly [kstDateBrand]: "KstDate" };

const KST_DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;

export function kstDate(value: string): KstDate {
  if (!KST_DATE_PATTERN.test(value)) throw new RangeError(`KST date must be YYYY-MM-DD but was ${value}`);
  return value as KstDate;
}

/**
 * 그 날이 KST에서 시작하는 시각이다.
 *
 * 달력 구간을 시각으로 옮기는 자리를 여기 하나만 두는 이유는, 조회가 `opened_at`을 KST 날짜로 바꿔
 * 비교하면 그 열의 인덱스 범위 스캔이 깨지고 같은 요청이 경로마다 다른 경계를 갖기 때문이다.
 * 시간대 이름은 `kst-month.ts`가 소유하며 여기서 다시 선언하지 않는다(AGENTS 6·15).
 */
export function kstDayStart(date: KstDate): Temporal.Instant {
  return Temporal.PlainDate.from(date).toZonedDateTime(KST_TIME_ZONE).toInstant();
}

/**
 * 그 **다음** 날이 KST에서 시작하는 시각이다. 양끝을 포함한 달력 구간 `[from, to]`는 시각 축에서
 * 반열림 `[kstDayStart(from), kstDayAfter(to))`가 된다. 마지막 날의 23:59:59.999를 끝으로 잡으면
 * 그 사이에 떨어진 관측 하나가 조용히 빠진다.
 */
export function kstDayAfter(date: KstDate): Temporal.Instant {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toZonedDateTime(KST_TIME_ZONE).toInstant();
}
