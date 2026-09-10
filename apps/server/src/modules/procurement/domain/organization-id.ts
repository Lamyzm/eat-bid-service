/** @module 책임: 구매기관을 가리키는 손실 없는 숫자 식별자 값과 그 brand를 소유한다. */
import { positiveBigintIdentity } from "@eatbid/domain";

declare const organizationIdBrand: unique symbol;

/** 기관 이름·유형은 바뀌므로 정체성은 양수 PostgreSQL signed bigint 하나만 담는다. 범위 불변식은 `packages/domain`이 소유한다. */
export type OrganizationId = bigint & { readonly [organizationIdBrand]: "OrganizationId" };

export function organizationId(value: bigint): OrganizationId {
  return positiveBigintIdentity<OrganizationId>(value, "OrganizationId");
}

export function organizationIdToString(value: OrganizationId): string {
  return value.toString(10);
}
