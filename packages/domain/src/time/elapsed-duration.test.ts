import { describe, expect, test } from "bun:test";

import { hours, milliseconds, minutes, seconds, toMilliseconds } from "./elapsed-duration.js";

describe("고정 경과 시간", () => {
  test("명명한 단위를 안전한 정수 밀리초로 변환한다", () => {
    expect(toMilliseconds(milliseconds(5))).toBe(5);
    expect(toMilliseconds(seconds(5))).toBe(5_000);
    expect(toMilliseconds(minutes(5))).toBe(300_000);
    expect(toMilliseconds(hours(1))).toBe(3_600_000);
  });

  test("0과 안전 범위의 경계값을 보존한다", () => {
    expect(toMilliseconds(milliseconds(0))).toBe(0);
    expect(toMilliseconds(milliseconds(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("음수와 비정수 및 변환 후 안전 범위 초과를 거부한다", () => {
    for (const create of [
      () => seconds(-1),
      () => milliseconds(0.1),
      () => minutes(Number.POSITIVE_INFINITY),
      () => seconds(Number.MAX_SAFE_INTEGER),
    ]) {
      expect(create).toThrow(RangeError);
    }
  });
});
