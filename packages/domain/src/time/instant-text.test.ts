import { describe, expect, test } from "bun:test";

import { formatInstantText, parseInstantText } from "./instant-text.js";
import { Temporal } from "./temporal.js";

describe("UTC Instant 문자열", () => {
  test("정규 UTC 문자열을 Temporal Instant로 해석한다", () => {
    expect(parseInstantText("2026-08-30T09:00:00Z").toString()).toBe("2026-08-30T09:00:00Z");
  });

  test("같은 시각의 지역 오프셋 표현을 정규 UTC 문자열로 직렬화한다", () => {
    const instant = Temporal.Instant.from("2026-08-30T18:00:00+09:00");

    expect(formatInstantText(instant)).toBe("2026-08-30T09:00:00Z");
  });

  test("UTC Z가 아닌 표현과 정규형이 아닌 표현을 거부한다", () => {
    for (const value of [
      "2026-08-30T18:00:00+09:00",
      "2026-08-30T09:00:00+00:00",
      "2026-08-30t09:00:00z",
      "2026-08-30T09:00:00.000Z",
    ]) {
      expect(() => parseInstantText(value)).toThrow();
    }
  });
});
