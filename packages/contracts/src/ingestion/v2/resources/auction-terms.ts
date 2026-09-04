/** @module 책임: 하한율·예정가격 방식·낙찰자 결정 방법을 관측 코드 그대로 담는 계약을 소유한다. */
import { z } from "zod";

import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 하한율은 화면의 "그날 하한"을 지탱하는 관측값이다(architecture.md §1). 실측 값은 90·88·84.245처럼
// 소수 셋째 자리까지 나오므로 BidRate(3자리)로 받는다.
export const normalizedAuctionTermsSchema = z.strictObject({
  floorRate: bidRateWireSchema.nullable(),
  plannedPriceMethod: sourceCodedValueSchema.nullable(),
  awardMethod: sourceCodedValueSchema.nullable(),
}).meta({
  id: "NormalizedAuctionTerms",
  description: "Observed award terms: floor rate, reserve-price method and award method as source codes.",
});

export type NormalizedAuctionTerms = z.infer<typeof normalizedAuctionTermsSchema>;
