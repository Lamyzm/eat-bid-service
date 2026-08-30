import { describe, expect, test } from "bun:test";

import { canonicalDecimal } from "./canonical-decimal.js";

describe("정규 고정 소수 문자열", () => {
  test("요청한 소수 자릿수와 큰 계수를 부동소수점 변환 없이 보존한다", () => {
    expect(canonicalDecimal("10000000.10", 2)).toBe("10000000.10");
    expect(canonicalDecimal("90071992547409931234567890.00", 2)).toBe(
      "90071992547409931234567890.00",
    );
    expect(canonicalDecimal("0", 0)).toBe("0");
    expect(canonicalDecimal("0.123456789012345678", 18)).toBe("0.123456789012345678");
  });

  test("선행 0과 부호와 지수 및 자릿수 불일치를 거부한다", () => {
    for (const value of ["01.00", "1", "1.0", "1.000", "1e3", "-1.00", "+1.00", "NaN"]) {
      expect(() => canonicalDecimal(value, 2)).toThrow();
    }
  });

  test("유효하지 않은 scale을 거부한다", () => {
    for (const scale of [-1, 0.1, 19, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY]) {
      expect(() => canonicalDecimal("1.00", scale)).toThrow(RangeError);
    }
  });

  test("지원 범위를 넘는 정확한 자릿수 문자열도 의도적으로 거부한다", () => {
    expect(() => canonicalDecimal("0.1234567890123456789", 19)).toThrow(
      "Decimal scale must be between 0 and 18",
    );
  });
});
