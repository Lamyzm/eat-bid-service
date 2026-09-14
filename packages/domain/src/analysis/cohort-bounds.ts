/** @module 책임: 분석 기간의 KST 달력 경계와 관측 명단 행 수의 포함 규칙을 소유한다. */
import { Temporal } from "../time/temporal.js";
import type { SampleCount } from "../numeric/quantities.js";

/** 종료일을 포함하되 DB 조건은 다음 KST 날짜 미만으로 통일해 마지막 초 이하 정밀도를 잃지 않는다. */
export function analysisDateRange(from: Temporal.PlainDate, to: Temporal.PlainDate) {
  if (from.calendarId !== "iso8601" || to.calendarId !== "iso8601") {
    throw new RangeError("분석 날짜는 ISO 달력이어야 합니다.");
  }
  if (Temporal.PlainDate.compare(from, to) > 0) throw new RangeError("분석 시작일이 종료일보다 늦습니다.");
  return Object.freeze({
    fromInclusive: from.toZonedDateTime("Asia/Seoul").toInstant(),
    toExclusive: to.add({ days: 1 }).toZonedDateTime("Asia/Seoul").toInstant(),
  });
}

/** null은 미관측이며 0명이 아니다. 필터가 없을 때만 다른 포함 요건을 통과한 미관측 명단을 유지한다. */
export function analysisListCountRange(min: SampleCount | null, max: SampleCount | null) {
  if (min !== null && max !== null && min > max) throw new RangeError("명단 최소가 최대보다 큽니다.");
  return Object.freeze({
    min,
    max,
    includes(value: SampleCount | null): boolean {
      if (value === null) return min === null && max === null;
      return (min === null || value >= min) && (max === null || value <= max);
    },
  });
}
