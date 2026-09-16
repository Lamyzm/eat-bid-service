/** @module 책임: mart.open_auction_snapshot 한 행과 그 행의 (기관, 하한율) 코호트 요약을 담는 열린 공고 resource 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { codeReferenceSchema } from "../../../values/code-reference";
import { eligibilityAreaSchema, maxEligibilityAreaSelection } from "../../../values/eligibility-area";
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
 * 이 행과 같은 하한율에서 이 기관이 가장 최근에 개찰한 회차 하나다. 낙찰률·그날 하한·명단 수를 서로 다른
 * 회차에서 뽑아 나란히 놓으면 화면이 없는 회차를 말하게 되므로 다섯 값은 반드시 같은 회차에서 온다.
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

/**
 * 이 행의 `organization`과 `floorRate`가 함께 정하는 코호트 하나의 요약이다. 하한율이 다르면 그날 하한이
 * 다른 자리에 서서 겹치지 않는 판이 되므로 같은 기관이라도 하한율을 섞지 않는다(screen-system §6.4.1,
 * PDR-0004). 품목은 반대로 좁히지 않는다 — 하한율을 고정하면 품목별로 갈리는 것이 없어 표본만 줄어든다.
 * 코호트를 만들 수 없는 행, 즉 기관 미확인이거나 `floorRate`가 미관측인 행은 이 블록이 통째로 null이다.
 * 행마다 실어 N+1을 만들지 않으며(architecture.md §3.3) 활성 org_round_summary build 하나에서만 센다.
 */
export const openAuctionOrgSummarySchema = z.strictObject({
  // 이 코호트에서 **기준 시각까지 개찰된** 회차가 몇인가. 아직 안 열린 회차는 아직 일어나지 않은 판이라
  // 세지 않는다 — 세면 표본이 부풀고 아래 중앙값이 옮겨 간다. 이 수는 아래 중앙값의 모집단이 아니며,
  // 0은 "이 하한에서 개찰된 회차가 아직 없다"는 셀 수 있는 사실이라 요약 없음(null)과 합치지 않는다.
  attemptCount: nonNegativeCountSchema,
  // 보통 참여. percentile_disc(0.5)라 실제 관측된 명단 수 하나이며 평균이 아니다.
  medianListCount: nonNegativeCountSchema.nullable(),
  // 위 중앙값을 만든 표본 수. 명단이 미관측인 회차는 빠지므로 attemptCount와 다를 수 있다(AGENTS 7).
  listCountSampleCount: nonNegativeCountSchema,
  // 이 코호트에서 개찰 시각이 관측된 회차가 하나도 없으면 null이다.
  lastRound: openAuctionLastRoundSchema.nullable(),
}).meta({ id: "OpenAuctionOrgSummary" });

export const openAuctionRowSchema = z.strictObject({
  auctionAttemptId: positiveBigintTextSchema,
  // 목록이 준 기관 코드가 core에 없으면 조직이 null로 남는다. "기관 없음"을 "이름 미확인"과 합치지 않는다.
  organization: openAuctionOrganizationSchema.nullable(),
  // 아래 셋은 목록이 아니라 같은 공고의 최신 상세 해석에서 빌드 시점에 조인된 값이다(EAT-39 판정 A·B·C).
  // 아직 상세를 따지 않은 신규 공고는 셋 다 null이며 그 사실은 `termsRevisionId`가 함께 말한다.
  itemLabel: z.string().min(1).max(512).nullable(),
  /**
   * 원천이 표시하는 공고 제목이다. 상세에서 오는 관측 문자열이고 검색 술어가 이미 이 값을 본다. 화면의
   * 행 둘째 줄이 이것을 말한다(U9, EAT-260). 아직 상세를 따지 않은 공고는 null이다.
   */
  title: z.string().min(1).max(512).nullable(),
  /**
   * 원천이 표시하는 공고번호다. **표시·복사용이지 정체성이 아니다**(AGENTS 2) — 행의 정체성은
   * `auctionAttemptId` 하나다. 우리는 eaT 옆에 두는 도구라 마지막 한 걸음이 늘 "이 판을 eaT에서 연다"인데,
   * 번호가 없으면 학교 이름으로 다시 검색해야 하고 같은 학교의 A/B 판이 둘이면 거기서 또 헷갈린다(EAT-248).
   * 상세에서 오는 값이라 아직 상세를 따지 않은 공고는 null이다.
   */
  displayBidNo: z.string().min(1).max(64).nullable(),
  /**
   * 단독입찰 처리 방법(`eat:solo-bid-method`, 허용함/허용안함)이다. 참여 0곳의 뜻을 바꾼다 — 허용안함이면
   * 혼자 들어가면 유찰이다(2026-09-16 실측 30건 중 29건, EAT-249). 코드 참조 그대로 싣고 불리언으로 접지
   * 않는다: "허용함"과 "미관측"이 한 값이 되면 안 된다(AGENTS 3). eat-v4 전에 해석된 공고는 null이다.
   */
  soloBidMethod: codeReferenceSchema.nullable(),
  // 사정률 축의 상수(하한율)다. 소스가 셋째 자리까지 표시하며 mart numeric(6,3)과 같다.
  floorRate: bidRateWireSchema.nullable(),
  region: openAuctionRegionSchema.nullable(),
  /**
   * 이 공고가 참가를 제한한 지역이다. 위 `region`(공고지역)과 **다른 체계**이며 섞어 읽지 않는다
   * (AGENTS 6). `null`은 "제한이 없다"가 아니라 **관측하지 못했다**는 뜻이다. 열린 공고 404건 중 7건이
   * 그런 상태였고 무작위 결측이 아니었다 — 학교가 아닌 기관(군수지원여단·항공안전단·요양센터)에 몰려
   * 있었다(2026-09-11 실측). 제한 없음으로 단정하면 사장님이 낼 수 있는 공고가 목록에서 사라지므로
   * 화면은 이 값을 `제한지역 미관측`으로 드러낸다(AGENTS 3, ADR 0048 결정 3).
   */
  eligibilityAreas: z.array(eligibilityAreaSchema).max(maxEligibilityAreaSelection).nullable(),
  termsRevisionId: positiveBigintTextSchema.nullable(),
  closesAt: instantTextSchema.nullable(),
  baseAmount: moneyWireSchema.nullable(),
  // 목록이 표시한 참여 수(`BID_CNT`) 관측이다. 우리가 세지 않는다(ADR 0030).
  bidCount: nonNegativeCountSchema.nullable(),
  // 이 행을 만든 목록 관측 시각. 같은 build 안에서도 poll-open 실행이 여럿이라 행마다 다르다.
  observedAt: instantTextSchema,
  sourceLastChangedAt: instantTextSchema.nullable(),
  // 코호트는 이 행의 기관과 하한율이 함께 정한다. "회차 0건"과 "요약 없음"은 다른 사실이라 합치지 않는다.
  orgSummary: openAuctionOrgSummarySchema.nullable(),
}).meta({ id: "OpenAuction", description: "One open auction observed in mart.open_auction_snapshot with the round summary for its (organization, floor rate) cohort." });

export type OpenAuction = z.infer<typeof openAuctionRowSchema>;
export type OpenAuctionOrgSummary = z.infer<typeof openAuctionOrgSummarySchema>;
export type OpenAuctionLastRound = z.infer<typeof openAuctionLastRoundSchema>;
