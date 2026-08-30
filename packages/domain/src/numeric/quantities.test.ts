import { describe, expect, test } from "bun:test";

import {
  byteLength,
  capturedRecordCount,
  expectedRecordCount,
  payloadByteLimit,
  publishedRecordCount,
  sampleCount,
  type ByteLength,
  type CapturedRecordCount,
  type ExpectedRecordCount,
  type PayloadByteLimit,
  type PublishedRecordCount,
  type SampleCount,
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

  test("각 수량과 바이트 의미는 컴파일 시 서로 대입할 수 없다", () => {
    const expected: ExpectedRecordCount = expectedRecordCount(1n);
    const captured: CapturedRecordCount = capturedRecordCount(1n);
    const published: PublishedRecordCount = publishedRecordCount(1n);
    const sample: SampleCount = sampleCount(1n);
    const bytes: ByteLength = byteLength(1n);
    const limit: PayloadByteLimit = payloadByteLimit(1);

    // @ts-expect-error ExpectedRecordCount와 CapturedRecordCount는 교환할 수 없다.
    const capturedFromExpected: CapturedRecordCount = expected;
    // @ts-expect-error CapturedRecordCount와 PublishedRecordCount는 교환할 수 없다.
    const publishedFromCaptured: PublishedRecordCount = captured;
    // @ts-expect-error PublishedRecordCount와 SampleCount는 교환할 수 없다.
    const sampleFromPublished: SampleCount = published;
    // @ts-expect-error SampleCount와 ByteLength는 교환할 수 없다.
    const bytesFromSample: ByteLength = sample;
    // @ts-expect-error ByteLength와 PayloadByteLimit은 기반 타입과 의미가 모두 다르다.
    const limitFromBytes: PayloadByteLimit = bytes;

    expect([
      capturedFromExpected,
      publishedFromCaptured,
      sampleFromPublished,
      bytesFromSample,
      limitFromBytes,
    ]).toEqual([expected, captured, published, sample, bytes]);
    expect(limit).toBe(1);
  });
});
