/**
 * @module 책임: 운영자가 자리를 주고·늘리고·거둘 때 기간의 시작과 끝을 KST 달력으로 정하는 규칙을 소유한다(ADR 0071 결정 2·7).
 *
 * DB와 시계를 모르는 순수 함수다. 끝은 반열림 `[시작, 끝)`의 끝이라 "끝나는 날"은 그 직전 KST 날짜다. 시작일 11-06에 3개월이면
 * 끝은 2027-02-06 0시이고 화면은 "2027-02-05까지"로 읽는다.
 */
import { Temporal } from "@eatbid/domain";

const KST = "Asia/Seoul";

function startOfKstDay(date: Temporal.PlainDate): Temporal.Instant {
  return date.toZonedDateTime({ timeZone: KST }).toInstant();
}

export type GrantPeriod =
  | { readonly kind: "period"; readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant }
  | { readonly kind: "start-in-past" };

/**
 * 시작일이 오늘이면 지금부터, 뒤 날짜면 그날 0시부터다. 과거 날짜는 받지 않는다 — 우선권 시작일이 자리 시작과 같으므로
 * 과거로 넣으면 이미 다른 업체가 맡은 공고의 순서를 뒤에서 앞지른다. 바로잡을 일은 운영자 정정이 따로 진다.
 */
export function grantPeriod(input: { readonly startDate: Temporal.PlainDate; readonly months: number; readonly now: Temporal.Instant }): GrantPeriod {
  const today = input.now.toZonedDateTimeISO(KST).toPlainDate();
  const order = Temporal.PlainDate.compare(input.startDate, today);
  if (order < 0) return { kind: "start-in-past" };
  const startsAt = order === 0 ? input.now : startOfKstDay(input.startDate);
  return { kind: "period", startsAt, endsAt: startOfKstDay(input.startDate.add({ months: input.months })) };
}

/**
 * 끝만 늘린다. 지금 끝의 KST 날짜에 개월 수를 더한 날 0시다. 끝이 0시가 아닌 자리(회수로 잘렸다가 되살린 경우 등)도
 * 그날 0시로 맞춘다 — 끝나는 날을 날짜로 말하는 화면과 기간이 어긋나지 않게 한다.
 */
export function extendedEnd(input: { readonly endsAt: Temporal.Instant; readonly months: number }): Temporal.Instant {
  const endDate = input.endsAt.toZonedDateTimeISO(KST).toPlainDate();
  return startOfKstDay(endDate.add({ months: input.months }));
}

/**
 * 거둔 자리의 새 끝이다. 이미 시작했으면 지금, 아직 시작 전이면 시작 시각이다. 시작 시각으로 자르면 빈 기간이 되어 어떤 자리와도
 * 겹치지 않는다(`market_seat` 주석).
 */
export function revokedEnd(input: { readonly startsAt: Temporal.Instant; readonly now: Temporal.Instant }): Temporal.Instant {
  return Temporal.Instant.compare(input.now, input.startsAt) < 0 ? input.startsAt : input.now;
}

/** 끝났거나 이미 거둔 자리다. 늘리기·거두기는 살아 있는 자리에만 한다. */
export function hasEnded(input: { readonly endsAt: Temporal.Instant; readonly now: Temporal.Instant }): boolean {
  return Temporal.Instant.compare(input.endsAt, input.now) <= 0;
}
