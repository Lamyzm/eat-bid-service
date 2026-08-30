declare const auctionIdBrand: unique symbol;

export type AuctionId = bigint & { readonly [auctionIdBrand]: "AuctionId" };

export function auctionId(value: bigint): AuctionId {
  if (value <= 0n) throw new RangeError("AuctionId must be a positive bigint");
  return value as AuctionId;
}

export function auctionIdToString(value: AuctionId): string {
  return value.toString(10);
}
