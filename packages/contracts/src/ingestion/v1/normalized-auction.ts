import { z } from "zod";

import { normalizedBuyerSchema } from "./resources/buyer";
import { normalizedClassificationSchema } from "./resources/classification";
import { normalizedAuctionIdentitySchema } from "./resources/identity";
import { normalizedLocationSchema } from "./resources/location";
import { normalizedAuctionPricingSchema } from "./resources/pricing";
import { normalizedAuctionScheduleSchema } from "./resources/schedule";

/**
 * Python normalize과 canonical projection 사이 wire는 공개 API와 수명주기가 다르므로 독립 버전으로 고정한다.
 */
export const normalizedAuctionV1Schema = z.strictObject({
  contractVersion: z.literal("eatbid.ingestion.auction.v1"),
  identity: normalizedAuctionIdentitySchema,
  buyer: normalizedBuyerSchema,
  location: normalizedLocationSchema,
  schedule: normalizedAuctionScheduleSchema,
  pricing: normalizedAuctionPricingSchema,
  classification: normalizedClassificationSchema,
}).meta({
  id: "EatbidIngestionAuctionV1",
  description: "Versioned normalized eaT auction interchange contract.",
});

export type NormalizedAuctionV1 = z.infer<typeof normalizedAuctionV1Schema>;
