import { canonicalDecimal, type CanonicalDecimal } from "./canonical-decimal.js";

export type Currency = "KRW";

export type Money = Readonly<{
  amount: CanonicalDecimal;
  currency: Currency;
}>;

/** 1차 KRW 계약은 금액의 소수 둘째 자리 표현까지 보존하며 통화 없는 금액을 만들지 않는다. */
export function krw(amount: CanonicalDecimal): Money {
  canonicalDecimal(amount, 2);
  return Object.freeze({ amount, currency: "KRW" });
}
