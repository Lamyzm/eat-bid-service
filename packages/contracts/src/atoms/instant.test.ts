import { describe, expect, test } from "bun:test";

import { instantTextSchema } from "./instant";

describe("canonical UTC instant 문자열 계약", () => {
  test("윤년과 canonical 나노초 정밀도 값을 허용한다", () => {
    for (const valid of [
      "2000-02-29T23:59:59Z",
      "2024-02-29T00:00:00.1Z",
      "2026-08-30T00:00:00.000000001Z",
    ]) {
      expect(instantTextSchema.safeParse(valid).success, valid).toBe(true);
    }
  });

  test("달력에 없는 날짜와 UTC가 아닌 offset을 거부한다", () => {
    for (const invalid of [
      "1900-02-29T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-08-30T09:00:00+09:00",
    ]) {
      expect(instantTextSchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  test("9자리를 넘거나 0으로 끝나는 비정규 소수초를 거부한다", () => {
    for (const invalid of [
      "2026-08-30T00:00:00.0000000001Z",
      "2026-08-30T00:00:00.10Z",
      "2026-08-30T00:00:00.000000000Z",
    ]) {
      expect(instantTextSchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });
});
