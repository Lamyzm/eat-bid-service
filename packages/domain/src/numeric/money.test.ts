import { describe, expect, test } from "bun:test";

import { canonicalDecimal } from "./canonical-decimal.js";
import { isMoney, krw } from "./money.js";

describe("KRW 금액", () => {
  test("정확히 두 자리인 금액과 통화를 불변 값으로 묶는다", () => {
    const money = krw(canonicalDecimal("1.00", 2));

    expect(money).toEqual({ amount: "1.00", currency: "KRW" });
    expect(Object.isFrozen(money)).toBe(true);
  });

  test("두 자리 소수가 아닌 정규 소수는 KRW 금액으로 받지 않는다", () => {
    expect(() => krw(canonicalDecimal("1.0", 1))).toThrow();
  });

  test("runtime guard가 구조와 domain 금액 불변식을 함께 검증한다", () => {
    expect(isMoney({ amount: "1.00", currency: "KRW" })).toBe(true);
    for (const invalid of [
      null,
      { amount: "1.0", currency: "KRW" },
      { amount: "01.00", currency: "KRW" },
      { amount: "1.00", currency: "USD" },
      { amount: "1.00", currency: "KRW", hiddenUnit: "won" },
    ]) {
      expect(isMoney(invalid)).toBe(false);
    }

    const throwingAmount = Object.defineProperty({ currency: "KRW" }, "amount", {
      enumerable: true,
      get: () => { throw new Error("악의적 getter"); },
    });
    expect(() => isMoney(throwingAmount)).not.toThrow();
    expect(isMoney(throwingAmount)).toBe(false);
  });
});
