/**
 * @module 책임: PostgreSQL 행의 식별자·금액·비율·라벨 문자열을 도메인 값으로 닫는 변환과 코드 참조 record
 * 조립을 소유해, 같은 행 규약을 어댑터마다 다시 적지 않게 한다.
 */
import {
  baseRelativeBidRate,
  bidRate,
  canonicalDecimal,
  krw,
  observedBidRate,
  type BaseRelativeBidRate,
  type BidRate,
  type Money,
  type ObservedBidRate,
} from "@eatbid/domain";
import type { CodeReferenceRecord } from "../../application/auction-reader";

export function bigintValue(value: string | bigint): bigint {
  // 드라이버 설정에 따라 문자열로 오는 bigint도 Number를 거치지 않고 동일한 도메인 값으로 복원한다.
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

/**
 * 공백뿐인 라벨은 관측된 것이 아니라 비어 있는 것이다. 기관 이름·품목·업체명·코드 라벨이 같은 규약을
 * 쓴다. 빈 문자열을 내보내면 화면이 이름 없는 것을 이름 있는 것처럼 그린다.
 */
export function observedLabel(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}

/** 코드 문자열만 있고 체계를 모르는 참조는 만들지 않는다. 체계 없는 코드는 정체성이 아니다(AGENTS 6). */
export function codeReferenceRecord(
  codeValueId: string | bigint | null,
  code: string | null,
  scheme: string | null,
  label: string | null,
): CodeReferenceRecord | null {
  if (codeValueId === null || code === null || scheme === null) return null;
  return { codeValueId: bigintValue(codeValueId), code, scheme, label: observedLabel(label) };
}

/**
 * `json_agg`가 실어 온 참가제한지역 한 건이다. `code_value_id`가 문자열인 이유는 JSON 숫자가 bigint를
 * 무손실로 담지 못하기 때문이며(ADR 0018), 그 문자열은 여기서 바로 bigint로 닫힌다.
 */
export interface EligibilityAreaJson {
  readonly code_value_id: string;
  readonly code: string;
  readonly scheme: string;
  readonly label: string | null;
}

/**
 * 관측이 없으면 `json_agg`가 null을 준다. 그 null을 빈 배열로 바꾸지 않는 이유는 "제한이 없는 공고"와
 * "제한지역을 관측하지 못한 공고"가 사용자에게 다른 사실이기 때문이다(AGENTS 3).
 */
export function eligibilityAreaRecords(
  value: readonly EligibilityAreaJson[] | null,
): readonly CodeReferenceRecord[] | null {
  if (value === null) return null;
  return value.map((entry) => {
    const record = codeReferenceRecord(entry.code_value_id, entry.code, entry.scheme, entry.label);
    if (record === null) throw new TypeError("Database eligibility area row is incomplete");
    return record;
  });
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

export function observedBidRateValue(value: string | null): ObservedBidRate | null {
  if (value === null) return null;
  try {
    // 원천 사정률의 numeric(15,3)을 손실 없이 옮긴다. 100 초과는 파싱 실패나 미관측이 아니다.
    return observedBidRate(canonicalDecimal(value, 3));
  } catch (cause) {
    throw new TypeError("Database observed bid rate is invalid", { cause });
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
