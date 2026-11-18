/**
 * @module 책임: 넣을 공고의 시각(마감·기준 시각)을 KST 달력의 날 수·칩 이름·"저녁 7시" 꼴 글로 바꾼다.
 *
 * 묶음과 시각은 화면을 연 사람의 기기 시간대가 아니라 KST로 정한다. eaT 마감은 KST이고, 기기 시간대를 따르면 해외에서 연
 * 화면이 하루를 다르게 묶는다.
 */
import { Temporal } from '@eatbid/domain';

const KST = 'Asia/Seoul';
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

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

function weekday(time: Temporal.ZonedDateTime): string {
  return WEEKDAYS[time.dayOfWeek - 1]!;
}

/** "내일 22일 (목)"·"23일 (금)"·"11월 2일 (월)"처럼 마감일 칩 이름이다. 달이 기준 시각과 다를 때만 달을 붙인다. */
export function closingDayText(
  asOf: Temporal.ZonedDateTime,
  closes: Temporal.ZonedDateTime
): string {
  const date =
    closes.month === asOf.month ? `${closes.day}일` : `${closes.month}월 ${closes.day}일`;
  return `${daysUntil(asOf, closes) === 1 ? '내일 ' : ''}${date} (${weekday(closes)})`;
}

/** 두 날짜가 같은 주(월~일)인지 본다. 칩 줄은 주가 바뀌는 자리에 구분선을 긋는다. */
export function sameWeek(left: Temporal.PlainDate, right: Temporal.PlainDate): boolean {
  return left.yearOfWeek === right.yearOfWeek && left.weekOfYear === right.weekOfYear;
}

function partOfDay(hour: number): string {
  if (hour < 6) return '새벽';
  if (hour < 12) return '오전';
  if (hour < 18) return '오후';
  return '저녁';
}

/** "10월 21일 (수) 저녁 7시"처럼 기준 시각이다. 분이 0이면 분을 쓰지 않는다. */
export function asOfText(asOf: Temporal.ZonedDateTime): string {
  const hour = asOf.hour % 12 === 0 ? 12 : asOf.hour % 12;
  const minute = asOf.minute === 0 ? '' : ` ${asOf.minute}분`;
  return `${asOf.month}월 ${asOf.day}일 (${weekday(asOf)}) ${partOfDay(asOf.hour)} ${hour}시${minute}`;
}
