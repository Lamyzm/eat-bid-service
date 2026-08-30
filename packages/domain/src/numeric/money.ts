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

/** 신뢰 경계의 unknown 값은 domain factory와 동일한 exact KRW 불변식을 통과해야 Money로 좁혀진다. */
export function isMoney(value: unknown): value is Money {
  try {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Record<PropertyKey, unknown>;
    if (
      Reflect.ownKeys(candidate).length !== 2
      || typeof candidate.amount !== "string"
      || candidate.currency !== "KRW"
    ) {
      return false;
    }

    krw(canonicalDecimal(candidate.amount, 2));
    return true;
  } catch {
    return false;
  }
}
