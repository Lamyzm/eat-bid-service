/** @module 책임: mart.org_round_summary 한 행을 담는 기관 회차 요약 resource와 build 계보 meta 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema, sourceReleaseIdTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { baseRelativeBidRateWireSchema, bidRateWireSchema } from "../../../values/rate";

export const organizationAuctionAttemptSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  announcedAt: instantTextSchema,
  openedAt: instantTextSchema.nullable(),
  // 품목 라벨 상한은 기관 이름(AuctionOrganization.name)과 같은 512자다. 원본 라벨이 잘려 들어오는
  // 것보다 계약이 통째로 실패하는 편이 관측 사실을 왜곡하지 않는다.
  item: z.strictObject({ codeValueId: positiveBigintTextSchema, label: z.string().min(1).max(512) }).nullable(),
  // eaT 사정률·낙찰률은 소수 셋째 자리까지 관측되며 mart numeric(6,3)과 같다(values/rate.ts).
  floorRate: bidRateWireSchema.nullable(),
  baseAmount: moneyWireSchema,
  winRate: bidRateWireSchema.nullable(),
  secondRate: bidRateWireSchema.nullable(),
  // 그날 하한만 축이 다르다. 하한율은 사정률 축의 상수이고 이 값은 그것을 기초금액 분모로 번역한
  // 파생값이라 분모가 다르다. 3자리에서 반올림하면 예정가격이 기초금액에 가까운 회차들의 하한이
  // 같은 값으로 뭉개지므로 넷째 자리를 담는 별도 wire 계약을 쓴다(설계 §1.3).
  dayFloorRate: baseRelativeBidRateWireSchema.nullable(),
  listCount: nonNegativeCountSchema.nullable(),
  // "무효"는 우리가 하는 판정이 아니라 소스의 판정이다(PDR-0002). 우리가 셀 수 있는 것은 그날 하한
  // 미만으로 들어온 명단 행 수뿐이므로 그 사실의 이름을 그대로 쓴다.
  belowDayFloorCount: nonNegativeCountSchema.nullable(),
  winnerSupplierPartyId: positiveBigintTextSchema.nullable(),
  supersedesAttemptId: positiveBigintTextSchema.nullable(),
}).meta({ id: "OrganizationAuctionAttempt", description: "One auction attempt summarized from mart.org_round_summary." });

/**
 * 모집단 보유율이다. `unknown`이 넷째 값인 이유는 지금 수집 구간에 시도 축이 없어 그 grain의 분모를
 * 낼 수 없기 때문이다. `partial`로 뭉개면 화면이 "일부 수집됨"이라고 거짓말한다(PDR-0003).
 * 코호트에 여러 행이 걸리면 가장 나쁜 값을 싣는다(`none` > `unknown` > `partial` > `complete`).
 */
export const martCoverageSchema = z.enum(["complete", "partial", "none", "unknown"])
  .meta({ id: "MartCoverage", description: "Worst population coverage verdict across the requested cohort." });

/**
 * 계보는 행이 아니라 build가 갖는다(ADR 0034). 자유 문자열 `martRelease`를 남기면 "release"라는
 * 이름의 값이 `sourceReleaseId`와 둘이 되어 어느 쪽이 권위인지 알 수 없다.
 * 활성 build가 아직 없는 상태는 오류가 아니라 계보 전체가 null인 빈 목록이다.
 */
export const organizationAuctionAttemptsMetaSchema = z.strictObject({
  sampleCount: nonNegativeCountSchema,
  // 표본이 어떤 품목으로 좁혀졌는지는 응답만 보고 재현돼야 한다(AGENTS 7). 요청 query의 item을
  // 그대로 되돌려 싣고, 품목을 지정하지 않은 전체 조회는 null이다.
  item: positiveBigintTextSchema.nullable(),
  buildId: positiveBigintTextSchema.nullable(),
  sourceReleaseId: sourceReleaseIdTextSchema.nullable(),
  calcVersion: z.string().min(1).max(32).nullable(),
  computedAt: instantTextSchema.nullable(),
  coverage: martCoverageSchema.nullable(),
  // 지역 축이 어떤 CodeScheme의 것인지는 build가 기록한다. 화면이 "이 분포는 eaT 공고지역 기준"이라고
  // 말할 수 있어야 행정안전부 코드로의 전환이 침묵하지 않는다(AGENTS 6).
  regionScheme: z.string().min(1).max(64).nullable(),
}).meta({ id: "OrganizationAuctionAttemptsMeta" });

export type OrganizationAuctionAttempt = z.infer<typeof organizationAuctionAttemptSchema>;
export type MartCoverage = z.infer<typeof martCoverageSchema>;
