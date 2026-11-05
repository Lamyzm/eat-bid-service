/** @module 책임: 하한율·예정가격 방식·낙찰자 결정 방법과 품목 제한·인증 종류 같은 참가 조건을 관측 코드 그대로 담는 계약을 소유한다. */
import { z } from "zod";

import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 하한율은 화면의 "그날 하한"을 지탱하는 관측값이다(architecture.md §1). 실측 값은 90·88·84.245처럼
// 소수 셋째 자리까지 나오므로 BidRate(3자리)로 받는다.
export const normalizedAuctionTermsSchema = z.strictObject({
  floorRate: bidRateWireSchema.nullable(),
  plannedPriceMethod: sourceCodedValueSchema.nullable(),
  awardMethod: sourceCodedValueSchema.nullable(),
  /**
   * 단독입찰 처리 방법(`ds_info.SGNS_BID_PRCS_MTHD_CD`, 허용함/허용안함)이다. 참여 0곳의 뜻을 바꾸는
   * 조건이라 읽는다 — 허용안함이면 혼자 들어가면 유찰이다(2026-09-16 실측 30건 중 29건, EAT-249).
   * optional인 이유는 `eligibilityAreas`와 같다: 이 필드가 생기기 전에 봉인된 v2·v3 payload에는 키가
   * 없고, 그 payload를 읽는 쪽이 없는 키를 실패로 보면 replay 전의 관측이 전부 막힌다(ADR 0038).
   */
  soloBidMethod: sourceCodedValueSchema.nullable().optional(),
  /**
   * 주요 취급 품목으로 참가를 제한하는가(`ds_info.MN_TRMT_LMT_YN`, Y/N)다. `N`이면 원천이 주요 품목 칸을 비우므로
   * 품목 원자가 없는 이유가 "못 읽음"이 아니라 "학교가 제한하지 않음"임을 이 코드가 말한다(183,777건 예외 0,
   * `docs/AUDIT-SOURCE.md` §4). 시장 자리는 `N`을 "품목 제한 없음" 품목 칸으로 받는다(ADR 0072).
   * optional인 이유는 `soloBidMethod`와 같다 — eat-v6 전에 봉인된 payload에는 키가 없다(ADR 0038).
   */
  mainItemRestriction: sourceCodedValueSchema.nullable().optional(),
  /**
   * 인증 종류(`ds_info.CERT_KND_CD`)다. 이름 칸이 없어 뜻을 확정하지 못했고 자리 판정에 쓰지 않는다(ADR 0072 결정 4).
   * 품목과 비슷하게 갈리지만 같은 학교가 달마다 다른 값을 쓰므로 품목으로 매핑하지 마라.
   */
  certificationKind: sourceCodedValueSchema.nullable().optional(),
}).meta({
  id: "NormalizedAuctionTerms",
  description: "Observed award and participation terms as source codes: floor rate, reserve-price method, award method, solo-bid handling, main-item restriction and certification kind.",
});

export type NormalizedAuctionTerms = z.infer<typeof normalizedAuctionTermsSchema>;
