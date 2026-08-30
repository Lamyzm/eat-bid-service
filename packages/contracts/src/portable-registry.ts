import { normalizedAuctionV1Schema } from "./ingestion/v1/normalized-auction";

export const portableContracts = Object.freeze([
  { id: "EatbidIngestionAuctionV1", schema: normalizedAuctionV1Schema },
] as const);
