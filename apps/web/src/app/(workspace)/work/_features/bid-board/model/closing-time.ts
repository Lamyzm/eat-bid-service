/**
 * @module 책임: 오늘 투찰의 마감 시각을 KST 달력 기준 묶음 이름("내일 · 오전 9시 마감")과 남은 시간("13분 뒤")으로 바꾼다.
 *
 * 묶음과 남은 시간은 화면을 연 사람의 기기 시간대가 아니라 KST로 정한다. eaT 마감은 KST이고, 기기 시간대를 따르면 해외에서 연
 * 화면이 하루를 다르게 묶는다.
 */
import { Temporal } from '@eatbid/domain';

const KST = 'Asia/Seoul';

export function kstOf(iso: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(KST);
}

/** "오전 10시", "오후 3시 10분"처럼 읽는 시각이다. 정오는 오후 12시다. */
export function clockText(time: Temporal.ZonedDateTime): string {
  const half = time.hour < 12 ? '오전' : '오후';
  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return time.minute === 0 ? `${half} ${hour}시` : `${half} ${hour}시 ${time.minute}분`;
}

/** 기준 시각에서 마감까지 남은 시간이다. 날이 바뀌면 시간을 세지 않고 "내일"이라고만 한다. */
export function relativeText(asOf: Temporal.ZonedDateTime, closes: Temporal.ZonedDateTime): string {
  if (Temporal.PlainDate.compare(closes.toPlainDate(), asOf.toPlainDate()) > 0) return '내일';
  const minutes = Math.floor(asOf.toInstant().until(closes.toInstant()).total({ unit: 'minutes' }));
  if (minutes < 60) return `${minutes}분 뒤`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간 뒤` : `${hours}시간 ${rest}분 뒤`;
}

/** 묶음 이름이다. 내일 마감이면 앞에 "내일 · "를 붙여 오늘 같은 시각 묶음과 헷갈리지 않게 한다. */
export function groupLabel(asOf: Temporal.ZonedDateTime, closes: Temporal.ZonedDateTime): string {
  const tomorrow = Temporal.PlainDate.compare(closes.toPlainDate(), asOf.toPlainDate()) > 0;
  return `${tomorrow ? '내일 · ' : ''}${clockText(closes)} 마감`;
}

export function hourMinuteText(time: Temporal.ZonedDateTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}
