import { describe, expect, test } from "bun:test";

import {
  byteLength,
  capturedRecordCount,
  expectedRecordCount,
  payloadByteLimit,
  publishedRecordCount,
  sampleCount,
} from "./quantities.js";

describe("목적이 분리된 수량과 바이트", () => {
  test("DB에 저장하는 수량과 바이트를 bigint로 보존한다", () => {
    const aboveSafeInteger = 9_007_199_254_740_993n;

    expect(expectedRecordCount(aboveSafeInteger)).toBe(aboveSafeInteger);
    expect(capturedRecordCount(aboveSafeInteger)).toBe(aboveSafeInteger);
    expect(publishedRecordCount(aboveSafeInteger)).toBe(aboveSafeInteger);
    expect(sampleCount(aboveSafeInteger)).toBe(aboveSafeInteger);
    expect(byteLength(aboveSafeInteger)).toBe(aboveSafeInteger);
  });

  test("음수인 수량과 바이트를 거부한다", () => {
    for (const create of [
      () => expectedRecordCount(-1n),
      () => capturedRecordCount(-1n),
      () => publishedRecordCount(-1n),
      () => sampleCount(-1n),
      () => byteLength(-1n),
    ]) {
      expect(create).toThrow(RangeError);
    }
  });

  test("payload 제한은 0 이상인 안전한 정수만 받는다", () => {
    expect(payloadByteLimit(0)).toBe(0);
    expect(payloadByteLimit(1_048_576)).toBe(1_048_576);
    expect(payloadByteLimit(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 0.1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => payloadByteLimit(value)).toThrow(RangeError);
    }
  });

});
