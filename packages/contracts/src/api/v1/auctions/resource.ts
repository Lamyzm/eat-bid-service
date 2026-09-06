/** @module 책임: 공개 공고 V1 응답에 실리는 수명주기별 resource 조합을 소유한다. */
import { z } from "zod";

import { auctionClassificationSchema } from "../../../resources/procurement/classification";
import { publicAuctionIdentitySchema } from "../../../resources/procurement/identity";
import { auctionLocationSchema } from "../../../resources/procurement/location";
import { auctionOrganizationSchema } from "../../../resources/procurement/organization";
import { auctionPricingSchema } from "../../../resources/procurement/pricing";
import { auctionScheduleSchema } from "../../../resources/procurement/schedule";
import { auctionTermsSchema } from "../../../resources/procurement/terms";
import { auctionProvenanceSchema } from "../../../values/provenance";

// 공개 응답은 수명주기별 resource를 닫아 내부 source payload나 저장소 열이 우발적으로 노출되지 않게 한다.
export const auctionResourceSchema = z.strictObject({
  identity: publicAuctionIdentitySchema,
  organization: auctionOrganizationSchema.nullable(),
  schedule: auctionScheduleSchema,
  pricing: auctionPricingSchema,
  provenance: auctionProvenanceSchema,
  // 뒤 세 블록은 화면이 비교 코호트를 만드는 재료다. 어느 것도 관측되지 않은 회차가 실제로 있으므로
  // 블록째로 nullable이며, 그때 화면은 값을 지어내지 않고 "미확인"을 그린다(AGENTS 3).
  terms: auctionTermsSchema.nullable(),
  location: auctionLocationSchema.nullable(),
  classification: auctionClassificationSchema.nullable(),
}).meta({ id: "EatbidApiV1Auction" });

export type AuctionResource = z.infer<typeof auctionResourceSchema>;
