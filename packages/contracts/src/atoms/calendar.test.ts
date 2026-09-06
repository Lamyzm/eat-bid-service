import { describe, expect, test } from "bun:test";

import { kstMonthTextSchema } from "./calendar";

describe("KST 달 atom", () => {
  test("네 자리 연도와 두 자리 달만 받는다", () => {
    for (const valid of ["2026-01", "2026-09", "2026-12", "1999-10"]) {
      expect(kstMonthTextSchema.parse(valid)).toBe(valid);
    }
  });

  test("달 경계를 벗어나거나 자릿수가 어긋난 문자열을 거부한다", () => {
    // 00과 13은 달이 아니고, 자릿수를 흘리면 정렬과 비교가 문자열 순서로 무너진다.
    for (const invalid of ["2026-00", "2026-13", "2026-1", "26-01", "2026-010", "2026/01", "2026-01-01", ""]) {
      expect(kstMonthTextSchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  test("OpenAPI 소비자가 읽을 정적 id와 패턴을 갖는다", () => {
    // runtime refine은 OpenAPI로 전파되지 않으므로 정적 패턴 하나가 wire 형태를 직접 소유해야 한다.
    expect(kstMonthTextSchema.meta()).toMatchObject({ id: "KstMonthText" });
  });
});
