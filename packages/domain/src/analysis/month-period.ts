/** @module 책임: 분석 기간 프리셋의 달력월 개수와 양끝을 포함한 날짜 범위를 정한다. */
import { Temporal } from '../time/temporal.js';

/** 현재 달의 미경과 날짜를 포함하지 않으며, 전체 보유기간을 임의의 몇 년으로 추정하지 않는다. */
export function analysisMonthPeriod(end: Temporal.PlainDate, months: 1 | 2 | 3 | 6 | 12) {
  if (end.calendarId !== 'iso8601') throw new RangeError('분석 날짜는 ISO 달력이어야 합니다.');
  const from = end.subtract({ months: months - 1 }).with({ day: 1 });
  return Object.freeze({ from, to: end });
}
