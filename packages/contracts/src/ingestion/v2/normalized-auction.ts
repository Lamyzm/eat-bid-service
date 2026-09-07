/** @module 책임: 명단·추첨·재입찰 블록을 포함한 정규화 수집 계약의 v2 root와 그 버전 리터럴을 소유한다. */
import { z } from "zod";

import { normalizedAuctionV1Schema } from "../v1/normalized-auction";
import { normalizedAuctionLineageSchema } from "./resources/attempt-link";
import { normalizedAuctionTermsSchema } from "./resources/auction-terms";
import { normalizedAwardDecisionSchema } from "./resources/award-decision";
import { normalizedBidRosterSchema } from "./resources/bid-roster";
import { normalizedLocationV2Schema } from "./resources/location";
import { normalizedReservePriceDrawSchema } from "./resources/reserve-price-draw";

/**
 * v1 root를 확장한 별도 root다. v1을 고치지 않는 이유는 projection이 저장된 canonical payload를 다시
 * 직렬화해 바이트 동일성을 검사하기 때문이다. 필수 필드를 더하면 봉인된 payload가 전부 불일치가 된다
 * (ADR 0025 sealed membership). optional 필드는 재직렬화가 producer가 쓴 키만 내는 규칙 아래에서만
 * 같은 root에 가산할 수 있고(ADR 0038), `location.eligibilityAreas`가 그 첫 사례다.
 */
export const normalizedAuctionV2Schema = normalizedAuctionV1Schema.omit({ contractVersion: true }).safeExtend({
  // safeExtend는 겹치는 키를 base의 subtype으로만 좁힐 수 있는데 두 버전 리터럴은 서로 subtype이 아니다.
  // 먼저 omit해 버전 키를 base에서 떼어내면 v2 리터럴이 계약 위반 없이 자기 자리를 갖는다.
  contractVersion: z.literal("eatbid.ingestion.auction.v2"),
  // v1 location의 subtype이라 safeExtend가 좁히기로 받는다. 봉인된 세 키는 그대로이고 라벨 관측만 얹는다.
  location: normalizedLocationV2Schema,
  terms: normalizedAuctionTermsSchema,
  roster: normalizedBidRosterSchema,
  award: normalizedAwardDecisionSchema.nullable(),
  reservePriceDraw: normalizedReservePriceDrawSchema,
  lineage: normalizedAuctionLineageSchema,
}).meta({
  id: "EatbidIngestionAuctionV2",
  description: "Versioned normalized eaT auction interchange contract including roster, draw and lineage blocks.",
});

export type NormalizedAuctionV2 = z.infer<typeof normalizedAuctionV2Schema>;
