/** @module 책임: 목적이 제한된 데이터베이스 port 주입 토큰을 소유한다. */
export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
export const DATABASE_READINESS = Symbol("DATABASE_READINESS");
export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");
/**
 * 한 응답 안의 여러 조회가 같은 스냅샷을 읽어야 할 때 쓰는 읽기 전용 경계다. 쓰기 `UNIT_OF_WORK`와
 * 나눈 이유는 격리 수준과 접근 방식이 다르기 때문이다. 하나로 합치면 읽기 경로가 쓰기 트랜잭션을 얻는다.
 */
export const READ_SNAPSHOT = Symbol("READ_SNAPSHOT");
export const REGISTERED_BUSINESS_READER = Symbol("REGISTERED_BUSINESS_READER");
export const OWN_BID_READER = Symbol("OWN_BID_READER");
export const AUCTION_READER = Symbol("AUCTION_READER");
export const AUCTION_ROSTER_READER = Symbol("AUCTION_ROSTER_READER");
export const OPEN_AUCTION_READER = Symbol("OPEN_AUCTION_READER");
export const ORGANIZATION_ATTEMPT_READER = Symbol("ORGANIZATION_ATTEMPT_READER");
export const WIN_RATE_DISTRIBUTION_READER = Symbol("WIN_RATE_DISTRIBUTION_READER");
export const CODE_READER = Symbol("CODE_READER");
export const ACCOUNT_REPOSITORY = Symbol("ACCOUNT_REPOSITORY");
