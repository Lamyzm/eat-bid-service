/** @module 책임: 공고 시도를 가리키는 손실 없는 숫자 식별자 값과 그 brand를 소유한다. */
import { positiveBigintIdentity } from "@eatbid/domain";

declare const auctionIdBrand: unique symbol;

/** 양수인 PostgreSQL signed bigint만 경매 식별자로 허용하는 손실 없는 도메인 값이다. 범위 불변식은 `packages/domain`이 소유한다. */
export type AuctionId = bigint & { readonly [auctionIdBrand]: "AuctionId" };

export function auctionId(value: bigint): AuctionId {
  return positiveBigintIdentity<AuctionId>(value, "AuctionId");
}

export function auctionIdToString(value: AuctionId): string {
  return value.toString(10);
}
