import { z } from "zod";

import { publicAuctionIdentitySchema } from "../../../resources/procurement/identity";
import { auctionOrganizationSchema } from "../../../resources/procurement/organization";
import { auctionPricingSchema } from "../../../resources/procurement/pricing";
import { auctionScheduleSchema } from "../../../resources/procurement/schedule";
import { auctionProvenanceSchema } from "../../../values/provenance";

// 공개 응답은 수명주기별 resource를 닫아 내부 source payload나 저장소 열이 우발적으로 노출되지 않게 한다.
export const auctionResourceSchema = z.strictObject({
  identity: publicAuctionIdentitySchema,
  organization: auctionOrganizationSchema.nullable(),
  schedule: auctionScheduleSchema,
  pricing: auctionPricingSchema,
  provenance: auctionProvenanceSchema,
}).meta({ id: "EatbidApiV1Auction" });

export type AuctionResource = z.infer<typeof auctionResourceSchema>;
