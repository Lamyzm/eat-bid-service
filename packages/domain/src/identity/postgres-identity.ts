/**
 * @module 책임: PostgreSQL signed bigint 범위의 양수 식별자 불변식을 팩토리 하나로 소유해, 모듈별 branded
 * 식별자가 같은 범위를 각자 다시 적지 않게 한다.
 */

/**
 * 저장소 식별자가 가질 수 있는 가장 큰 값이다. 공개 wire의 십진 문자열 상한은 `packages/contracts`의
 * identifier atom이 OpenAPI에 실을 수 있는 정적 패턴으로 따로 소유하며, 이 값은 그 문자열이 열리는 runtime
 * bigint 쪽 상한이다. 둘이 어긋나면 계약이 받은 식별자가 domain에서 거부되거나 그 반대가 된다.
 */
export const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

/**
 * 양수이고 signed bigint에 들어가는 값만 식별자로 연다. brand는 호출한 모듈이 정하고 범위는 여기서만
 * 정한다. 서버 모듈끼리는 내부 계층을 import하지 못하므로 이 불변식이 모듈마다 복제되면 한쪽만 바뀔 때
 * 조용히 갈라진다.
 */
export function positiveBigintIdentity<Id extends bigint>(value: bigint, name: string): Id {
  if (value <= 0n) throw new RangeError(`${name} must be a positive bigint`);
  if (value > POSTGRES_SIGNED_BIGINT_MAX) throw new RangeError(`${name} must fit a PostgreSQL signed bigint`);
  return value as Id;
}
