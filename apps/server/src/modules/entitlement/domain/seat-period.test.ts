import { describe, expect, test } from "bun:test";
import { Temporal } from "@eatbid/domain";

import { extendedEnd, grantPeriod, hasEnded, revokedEnd } from "./seat-period";

const now = Temporal.Instant.from("2026-11-05T03:00:00Z"); // KST 11-05 12:00

describe("자리 기간 규칙", () => {
  test("뒤 날짜 시작은 그날 KST 0시부터이고 끝은 개월 수 뒤 0시다", () => {
    expect(grantPeriod({ startDate: Temporal.PlainDate.from("2026-11-06"), months: 3, now })).toEqual({
      kind: "period",
      startsAt: Temporal.Instant.from("2026-11-05T15:00:00Z"),
      endsAt: Temporal.Instant.from("2027-02-05T15:00:00Z"),
    });
  });

  test("오늘 시작은 지금 시각부터이고 과거 날짜는 거절한다", () => {
    expect(grantPeriod({ startDate: Temporal.PlainDate.from("2026-11-05"), months: 1, now })).toEqual({
      kind: "period",
      startsAt: now,
      endsAt: Temporal.Instant.from("2026-12-04T15:00:00Z"),
    });
    expect(grantPeriod({ startDate: Temporal.PlainDate.from("2026-11-04"), months: 1, now })).toEqual({ kind: "start-in-past" });
  });

  test("KST 날짜 경계는 UTC 날짜가 아니라 서울 날짜로 정한다", () => {
    // UTC로는 11-04이지만 KST로는 이미 11-05 아침이다.
    const earlyMorning = Temporal.Instant.from("2026-11-04T22:00:00Z");
    expect(grantPeriod({ startDate: Temporal.PlainDate.from("2026-11-04"), months: 1, now: earlyMorning })).toEqual({ kind: "start-in-past" });
  });

  test("연장은 끝나는 날짜에 개월 수를 더한 0시이고 달 끝은 그 달 마지막 날로 맞춘다", () => {
    expect(extendedEnd({ endsAt: Temporal.Instant.from("2027-02-05T15:00:00Z"), months: 1 }))
      .toEqual(Temporal.Instant.from("2027-03-05T15:00:00Z"));
    // KST 2027-01-31 0시 + 1개월 → 2027-02-28 0시
    expect(extendedEnd({ endsAt: Temporal.Instant.from("2027-01-30T15:00:00Z"), months: 1 }))
      .toEqual(Temporal.Instant.from("2027-02-27T15:00:00Z"));
  });

  test("회수는 시작했으면 지금, 시작 전이면 시작 시각에서 끝낸다", () => {
    const later = Temporal.Instant.from("2026-11-10T15:00:00Z");
    expect(revokedEnd({ startsAt: Temporal.Instant.from("2026-11-01T15:00:00Z"), now })).toEqual(now);
    expect(revokedEnd({ startsAt: later, now })).toEqual(later);
    expect(hasEnded({ endsAt: now, now })).toBe(true);
    expect(hasEnded({ endsAt: later, now })).toBe(false);
  });
});
