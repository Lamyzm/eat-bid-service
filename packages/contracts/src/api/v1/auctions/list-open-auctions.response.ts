/** @module 책임: 열린 공고 목록 조회의 공개 V1 응답 봉투와 두 mart 계보를 이름 붙여 싣는 meta 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { maxEligibilityAreaSelection } from "../../../values/eligibility-area";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { closesWithinHoursSchema, MAX_OPEN_AUCTION_LIMIT } from "./list-open-auctions.query";
import { openAuctionRowSchema } from "./open-auction.resource";

/**
 * 이 응답만 두 mart build를 동시에 읽는다. 행은 `open_auction_snapshot`, 기관 요약은
 * `org_round_summary`의 활성 build에서 오며 둘은 서로 다른 release·calc_version에서 나올 수 있다.
 * 하나로 합치면 어느 build가 어느 열을 만들었는지 알 수 없으므로 계보를 이름 붙여 둘 싣는다(ADR 0034).
 * 활성 build가 없는 쪽은 계보 필드가 전부 null이며 그것은 오류가 아니다.
 */
export const openAuctionListMetaSchema = z.strictObject({
  // cursor 위치와 무관하게 필터를 만족하는 전체 행 수(AGENTS 7).
  sampleCount: nonNegativeCountSchema,
  // "열림"은 `closesAt > asOf`라는 판정이라 어느 시각 기준인지를 응답이 말해야 재현된다.
  asOf: instantTextSchema,
  // 요청 필터를 그대로 되돌려 실어 sampleCount가 어느 코호트의 수인지 응답만으로 닫는다.
  // 지역 축은 2단이라 둘을 따로 싣는다. `sigungu`가 비고 `sido`만 있으면 그 시도 전체를 본 것이다.
  sido: positiveBigintTextSchema.nullable(),
  sigungu: z.array(positiveBigintTextSchema).max(31).nullable(),
  eligibilityArea: z.array(positiveBigintTextSchema).max(maxEligibilityAreaSelection).nullable(),
  /**
   * 참가제한지역 필터를 걸었을 때 `sampleCount`가 어떻게 나뉘는지다. 필터가 없으면 둘 다 null이다.
   *
   * 나눠 싣는 이유는 두 수가 사용자에게 다른 뜻이기 때문이다. `eligibilityMatchedCount`는 고른 지역이
   * 실제로 잡은 공고 수이고, `eligibilityUnobservedCount`는 제한지역을 관측하지 못해 버리지 않고 남긴
   * 공고 수다. 둘을 합쳐 하나로 보이면 화면이 "내가 고른 지역의 공고"라고 말하면서 확인되지 않은 행을
   * 그 안에 섞게 된다(AGENTS 3). 합은 언제나 `sampleCount`다.
   */
  eligibilityMatchedCount: nonNegativeCountSchema.nullable(),
  eligibilityUnobservedCount: nonNegativeCountSchema.nullable(),
  item: z.string().min(1).max(512).nullable(),
  closesWithinHours: closesWithinHoursSchema.nullable(),
  // KST 달력일 축 둘. 시간 창과 뜻이 다르므로 되돌려 실을 때도 자리를 나눈다.
  closesOn: kstDateTextSchema.nullable(),
  announcedOn: kstDateTextSchema.nullable(),
  baseAmountMin: canonicalMoneyAmountSchema.nullable(),
  baseAmountMax: canonicalMoneyAmountSchema.nullable(),
  openAuctionSnapshotBuild: martBuildLineageSchema,
  orgRoundSummaryBuild: martBuildLineageSchema,
}).meta({ id: "OpenAuctionListMeta" });

export const openAuctionListV1ResponseSchema = z.strictObject({
  // 상한은 query의 `limit` 최대치와 같은 상수를 쓴다. 둘이 어긋나면 서버가 허용한 요청의 응답이
  // 검증에서 깨져 **정상 상태를 읽을 수 없게** 된다. `limit=200`이 실제로 500이 됐던 자리다(EAT-206).
  auctions: z.array(openAuctionRowSchema).max(MAX_OPEN_AUCTION_LIMIT),
  nextCursor: positiveBigintTextSchema.nullable(),
  meta: openAuctionListMetaSchema,
}).meta({ id: "EatbidApiV1OpenAuctions" });

export type OpenAuctionListMeta = z.infer<typeof openAuctionListMetaSchema>;
export type OpenAuctionListV1Response = z.infer<typeof openAuctionListV1ResponseSchema>;
