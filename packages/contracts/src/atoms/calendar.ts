/** @module 책임: 달력 경계를 가리키는 wire 문자열 atom을 소유한다. */
import { z } from "zod";

/**
 * KST 달 하나다. mart의 `month_kst`가 그 달 1일 `date`이고 달 경계는 개찰 시각의 KST 달이므로
 * 이 값은 시각이 아니라 달력 구간의 이름이다. `Instant`나 `Date`로 나르면 어느 시간대의 달인지가
 * 값에서 사라진다(AGENTS 15).
 *
 * 자릿수를 고정하는 이유는 문자열 정렬이 곧 달 순서가 되어야 하기 때문이다. `2026-1`을 허용하면
 * `2026-1`과 `2026-10`의 순서가 무너진다. runtime refine은 OpenAPI로 전파되지 않으므로 정적 ASCII
 * 패턴 하나가 wire 형태를 직접 소유한다.
 */
export const kstMonthTextSchema = z.string()
  .length(7)
  .regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])$/)
  .meta({
    id: "KstMonthText",
    description: "Canonical KST calendar month text as YYYY-MM; the month boundary is Asia/Seoul.",
    example: "2026-09",
  });

export type KstMonthText = z.infer<typeof kstMonthTextSchema>;

/**
 * KST 달력일 하나다. "몰리는 날"은 마감이 같은 KST 하루에 모인 공고 수라서 값의 정체가 시각이 아니라
 * 달력 구간의 이름이다. `Instant`로 나르면 어느 시간대의 하루인지가 값에서 사라진다(AGENTS 15).
 * 자릿수를 고정하는 이유는 달 atom과 같다 — 문자열 정렬이 곧 날짜 순서여야 한다.
 */
export const kstDateTextSchema = z.string()
  .length(10)
  .regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/)
  .meta({
    id: "KstDateText",
    description: "Canonical KST calendar date text as YYYY-MM-DD; the day boundary is Asia/Seoul.",
    example: "2026-06-22",
  });

export type KstDateText = z.infer<typeof kstDateTextSchema>;
