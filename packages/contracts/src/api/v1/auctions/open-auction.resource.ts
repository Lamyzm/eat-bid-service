/** @module 책임: mart.open_auction_snapshot 한 행과 그 기관의 최근 회차 요약을 담는 열린 공고 resource 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { codeReferenceSchema } from "../../../values/code-reference";
import { moneyWireSchema } from "../../../values/money";
import { baseRelativeBidRateWireSchema, bidRateWireSchema } from "../../../values/rate";

/**
 * `label`은 `core.organization.canonical_name`이 아니라 조직 코드에 매달린 관측 라벨이다. 조정된 이름이
 * 아직 없어도 화면이 기관을 부를 수 있게 하는 표시값이며 정체성은 `organizationId` 하나다(AGENTS 2,
 * EAT-39 판정 G). `type`은 `unknown`도 그대로 드러낸다.
 */
export const openAuctionOrganizationSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  label: z.string().min(1).max(512).nullable(),
  type: z.string().min(1).max(64),
}).meta({ id: "OpenAuctionOrganization" });

// 두 축은 활성 build가 선언한 한 체계 안의 계층이다(ADR 0034). 어느 축도 번역되지 않은 행은 블록째로 null이다.
export const openAuctionRegionSchema = z.strictObject({
  sido: codeReferenceSchema.nullable(),
  sigungu: codeReferenceSchema.nullable(),
}).meta({ id: "OpenAuctionRegion" });

/**
 * 이 기관이 가장 최근에 개찰한 회차 하나다. 낙찰률·그날 하한·명단 수를 서로 다른 회차에서 뽑아 나란히
 * 놓으면 화면이 없는 회차를 말하게 되므로 다섯 값은 반드시 같은 회차에서 온다.
 * 두 비율은 같은 축(기초금액 분모, numeric(9,4))이다. 사정률 축은 여기 싣지 않는다 — 분모가 예정가격이라
 * 사용자의 투찰률과 비교할 수 없다(AGENTS 15, PDR-0004).
 */
export const openAuctionLastRoundSchema = z.strictObject({
  auctionAttemptId: positiveBigintTextSchema,
  openedAt: instantTextSchema,
  awardedBidRate: baseRelativeBidRateWireSchema.nullable(),
  dayFloorBidRate: baseRelativeBidRateWireSchema.nullable(),
  listCount: nonNegativeCountSchema.nullable(),
  // "무효"는 우리가 하는 판정이 아니다. 셀 수 있는 것은 그날 하한 미만 명단 행 수뿐이다(PDR-0002).
  belowDayFloorCount: nonNegativeCountSchema.nullable(),
}).meta({ id: "OpenAuctionLastRound" });

/** 행마다 실어 N+1을 만들지 않는다(architecture.md §3.3). 활성 org_round_summary build 하나에서만 센다. */
export const openAuctionOrgSummarySchema = z.strictObject({
  // 이 기관을 우리가 몇 회차나 관측했나. 아래 중앙값의 모집단이 아니다.
  attemptCount: nonNegativeCountSchema,
  // 보통 참여. percentile_disc(0.5)라 실제 관측된 명단 수 하나이며 평균이 아니다.
  medianListCount: nonNegativeCountSchema.nullable(),
  // 위 중앙값을 만든 표본 수. 명단이 미관측인 회차는 빠지므로 attemptCount와 다를 수 있다(AGENTS 7).
  listCountSampleCount: nonNegativeCountSchema,
  // 개찰 시각이 관측된 회차가 하나도 없으면 null이다.
  lastRound: openAuctionLastRoundSchema.nullable(),
}).meta({ id: "OpenAuctionOrgSummary" });

export const openAuctionRowSchema = z.strictObject({
  auctionAttemptId: positiveBigintTextSchema,
  // 목록이 준 기관 코드가 core에 없으면 조직이 null로 남는다. "기관 없음"을 "이름 미확인"과 합치지 않는다.
  organization: openAuctionOrganizationSchema.nullable(),
  // 아래 셋은 목록이 아니라 같은 공고의 최신 상세 해석에서 빌드 시점에 조인된 값이다(EAT-39 판정 A·B·C).
  // 아직 상세를 따지 않은 신규 공고는 셋 다 null이며 그 사실은 `termsRevisionId`가 함께 말한다.
  itemLabel: z.string().min(1).max(512).nullable(),
  // 사정률 축의 상수(하한율)다. 소스가 셋째 자리까지 표시하며 mart numeric(6,3)과 같다.
  floorRate: bidRateWireSchema.nullable(),
  region: openAuctionRegionSchema.nullable(),
  termsRevisionId: positiveBigintTextSchema.nullable(),
  closesAt: instantTextSchema.nullable(),
  baseAmount: moneyWireSchema.nullable(),
  // 목록이 표시한 참여 수(`BID_CNT`) 관측이다. 우리가 세지 않는다(ADR 0030).
  bidCount: nonNegativeCountSchema.nullable(),
  // 이 행을 만든 목록 관측 시각. 같은 build 안에서도 poll-open 실행이 여럿이라 행마다 다르다.
  observedAt: instantTextSchema,
  sourceLastChangedAt: instantTextSchema.nullable(),
  // 활성 org_round_summary build에 이 기관 회차가 없으면 null이다. "회차 0건"과 "요약 없음"은 다른 사실이다.
  orgSummary: openAuctionOrgSummarySchema.nullable(),
}).meta({ id: "OpenAuction", description: "One open auction observed in mart.open_auction_snapshot with its organization's latest round summary." });

export type OpenAuction = z.infer<typeof openAuctionRowSchema>;
export type OpenAuctionOrgSummary = z.infer<typeof openAuctionOrgSummarySchema>;
export type OpenAuctionLastRound = z.infer<typeof openAuctionLastRoundSchema>;
