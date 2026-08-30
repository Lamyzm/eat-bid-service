import { describe, expect, test } from "bun:test";

import { canonicalDecimal } from "./canonical-decimal.js";
import { krw } from "./money.js";

describe("KRW 금액", () => {
  test("정확히 두 자리인 금액과 통화를 불변 값으로 묶는다", () => {
    const money = krw(canonicalDecimal("1.00", 2));

    expect(money).toEqual({ amount: "1.00", currency: "KRW" });
    expect(Object.isFrozen(money)).toBe(true);
  });

  test("두 자리 소수가 아닌 정규 소수는 KRW 금액으로 받지 않는다", () => {
    expect(() => krw(canonicalDecimal("1.0", 1))).toThrow();
  });
});
