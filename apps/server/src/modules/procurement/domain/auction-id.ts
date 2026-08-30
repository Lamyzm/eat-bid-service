declare const auctionIdBrand: unique symbol;

const postgresSignedBigintMax = 9_223_372_036_854_775_807n;

export type AuctionId = bigint & { readonly [auctionIdBrand]: "AuctionId" };

export function auctionId(value: bigint): AuctionId {
  if (value <= 0n) throw new RangeError("AuctionId must be a positive bigint");
  if (value > postgresSignedBigintMax) {
    throw new RangeError("AuctionId must fit a PostgreSQL signed bigint");
  }
  return value as AuctionId;
}

export function auctionIdToString(value: AuctionId): string {
  return value.toString(10);
}
