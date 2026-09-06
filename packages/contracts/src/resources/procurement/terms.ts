/** @module 책임: 공고 응답에 싣는 낙찰 조건(하한율·낙찰방식) resource를 소유한다. */
import { z } from "zod";

import { codeReferenceSchema } from "../../values/code-reference";
import { bidRateWireSchema } from "../../values/rate";

/**
 * 두 값은 분포 코호트의 키다. 하한율 90과 88은 사정률 축에서 서로 겹치지 않는 자리에 살고,
 * 단가입찰의 사정률은 총액과 같은 축이 아니다(domain-and-data §3.4). 그래서 화면이 호가창을
 * 만들려면 이 둘을 먼저 알아야 한다.
 *
 * 하한율은 사정률 축(분모 예정가격)의 상수이므로 0~100으로 닫힌 `BidRate`다. 관측 상한이 없는
 * `ObservedBidRate`와 섞지 않는다(AGENTS 15).
 *
 * 블록 전체가 null인 경우는 "두 값 모두 관측되지 않았다"는 뜻이며, 하나만 관측된 회차는 블록이
 * 있고 그 안에서 관측되지 않은 쪽만 null이다.
 */
export const auctionTermsSchema = z.strictObject({
  floorRate: bidRateWireSchema.nullable(),
  awardMethod: codeReferenceSchema.nullable(),
}).meta({
  id: "AuctionTerms",
  description: "Observed award terms of one auction revision: floor rate on the assessment-rate axis and the award-method code.",
});

export type AuctionTerms = z.infer<typeof auctionTermsSchema>;
