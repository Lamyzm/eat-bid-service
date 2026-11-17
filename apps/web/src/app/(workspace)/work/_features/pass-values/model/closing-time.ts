/**
 * @module 책임: 넣을 공고의 마감 시각을 KST 달력 기준 날 수와 "09:00" 꼴 시각으로 바꾼다.
 *
 * 묶음과 시각은 화면을 연 사람의 기기 시간대가 아니라 KST로 정한다. eaT 마감은 KST이고, 기기 시간대를 따르면 해외에서 연
 * 화면이 하루를 다르게 묶는다.
 */
import { Temporal } from '@eatbid/domain';

const KST = 'Asia/Seoul';

export function kstOf(iso: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(KST);
}

/** 기준 날짜에서 마감 날짜까지의 날 수다(오늘 0, 내일 1). */
export function daysUntil(asOf: Temporal.ZonedDateTime, closes: Temporal.ZonedDateTime): number {
  return asOf.toPlainDate().until(closes.toPlainDate(), { largestUnit: 'days' }).days;
}

export function hourMinuteText(time: Temporal.ZonedDateTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}
