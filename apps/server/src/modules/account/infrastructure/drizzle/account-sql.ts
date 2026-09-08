/**
 * @module 책임: 계정 저장 질의가 공유하는 데이터베이스 handle 계약과 driver 값 해석 규칙을 소유한다.
 */
import { Temporal } from "@eatbid/domain";
import type { SQL } from "drizzle-orm";

export interface AccountDatabase {
  execute(query: SQL): Promise<unknown>;
  transaction<A>(work: (transaction: AccountDatabase) => Promise<A>): Promise<A>;
}

// 시각을 UTC canonical 텍스트로 좁혀 받는다. driver 시간 표현을 이름으로 부를 수 있는 파일은
// `drizzle-auction-reader.ts` 하나이므로(AGENTS 17) 조회가 표현을 먼저 좁힌다.
export const UTC_INSTANT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
export const BUSINESS_NUMBER_SCHEME = "eat:business-number";

const UNIQUE_VIOLATION = "23505";

export function rows<Row>(result: unknown): Row[] {
  return Array.isArray(result) ? result as Row[] : [];
}

export function identifier(value: string | bigint): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

export function instantOf(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

/**
 * Drizzle은 driver 오류를 `DrizzleQueryError`로 감싸므로 최상위 `code`만 보면 23505를 놓친다. 놓치면
 * 동시 초기화에서 진 트랜잭션이 재시도 대신 503이 되고, 사용자는 정상 경쟁을 장애로 본다. 원인 사슬은
 * 순환이나 과도한 깊이를 만들지 않도록 제한해서만 따라간다.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
