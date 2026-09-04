/** @module 책임: 구매기관을 가리키는 손실 없는 숫자 식별자 값과 그 범위 불변식을 소유한다. */
declare const organizationIdBrand: unique symbol;

const postgresSignedBigintMax = 9_223_372_036_854_775_807n;

/** 기관 이름·유형은 바뀌므로 정체성은 양수 PostgreSQL signed bigint 하나만 담는다. */
export type OrganizationId = bigint & { readonly [organizationIdBrand]: "OrganizationId" };

export function organizationId(value: bigint): OrganizationId {
  if (value <= 0n) throw new RangeError("OrganizationId must be a positive bigint");
  if (value > postgresSignedBigintMax) {
    throw new RangeError("OrganizationId must fit a PostgreSQL signed bigint");
  }
  return value as OrganizationId;
}

export function organizationIdToString(value: OrganizationId): string {
  return value.toString(10);
}
