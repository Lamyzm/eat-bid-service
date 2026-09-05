/** @module 책임: PostgreSQL 행의 식별자·금액·비율 문자열을 도메인 값으로 닫는 변환을 소유한다. */
import {
  baseRelativeBidRate,
  bidRate,
  canonicalDecimal,
  krw,
  type BaseRelativeBidRate,
  type BidRate,
  type Money,
} from "@eatbid/domain";

export function bigintValue(value: string | bigint): bigint {
  // 드라이버 설정에 따라 문자열로 오는 bigint도 Number를 거치지 않고 동일한 도메인 값으로 복원한다.
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

export function moneyValue(amount: string | null, currency: string, required: true): Money;
export function moneyValue(amount: string | null, currency: string, required: false): Money | null;
export function moneyValue(amount: string | null, currency: string, required: boolean): Money | null {
  if (amount === null) {
    if (required) throw new TypeError("Database base amount is required");
    return null;
  }
  if (currency !== "KRW") throw new TypeError("Database currency must be KRW");
  try {
    // PostgreSQL numeric 문자열은 부동소수점으로 바꾸지 않고 domain factory가 scale 불변식을 확인한다.
    return krw(canonicalDecimal(amount, 2));
  } catch (cause) {
    throw new TypeError("Database money amount is invalid", { cause });
  }
}

export function bidRateValue(value: string | null): BidRate | null {
  if (value === null) return null;
  try {
    // mart numeric(6,3)이 아닌 scale은 공개 계약이 거부하므로 어댑터 경계에서 먼저 실패한다.
    return bidRate(canonicalDecimal(value, 3));
  } catch (cause) {
    throw new TypeError("Database bid rate is invalid", { cause });
  }
}

export function baseRelativeBidRateValue(value: string | null): BaseRelativeBidRate | null {
  if (value === null) return null;
  try {
    // mart numeric(9,4)의 넷째 자리를 반올림하지 않는다. 그날 하한은 이 자리에서만 회차끼리 구분된다.
    return baseRelativeBidRate(canonicalDecimal(value, 4));
  } catch (cause) {
    throw new TypeError("Database base-relative bid rate is invalid", { cause });
  }
}
