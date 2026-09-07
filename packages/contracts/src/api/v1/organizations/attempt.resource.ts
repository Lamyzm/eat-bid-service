/** @module 책임: mart.org_round_summary 한 행을 담는 기관 회차 요약 resource와 그 응답 meta 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { moneyWireSchema } from "../../../values/money";
import { baseRelativeBidRateWireSchema, bidRateWireSchema } from "../../../values/rate";

/**
 * 과거 회차 표는 개찰된 회차만 싣고 열린 회차는 상태 배너가 담당한다(EAT-81). `only`는 서버 clock 기준
 * `openedAt <= now`인 회차만, `any`는 개찰 여부와 무관하게 전부다. 개찰 시각을 관측하지 못한 회차는
 * 개찰됐다고 단정할 수 없으므로 `only`에서 빠진다 — unknown을 열림으로도 개찰로도 메우지 않는다(AGENTS 3).
 */
export const organizationAttemptOpenedFilterSchema = z.enum(["only", "any"]);
export type OrganizationAttemptOpenedFilter = z.infer<typeof organizationAttemptOpenedFilterSchema>;

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
  // 아래 둘은 위 사정률들과 분모가 다르다. 하한율은 사정률 축의 상수이고 그날 하한은 그것을 기초금액
  // 분모로 번역한 파생값이며, awardedBidRate는 같은 낙찰을 그 회차의 예정가격/기초금액 배율로 옮긴
  // 값이다. 3자리에서 반올림하면 예정가격이 기초금액에 가까운 회차들이 같은 값으로 뭉개지므로 둘 다
  // 넷째 자리를 담는 별도 wire 계약을 쓴다(설계 §1.3).
  //
  // winRate와 awardedBidRate는 같은 사실의 두 축이지 서로의 대체재가 아니다. 사용자가 투찰률로 넣는
  // 값의 "이 값이면 낙찰" 판정은 반드시 이 값과 견줘야 하고, 낙찰률 분포·호가창 눈금은 사정률
  // 축이어야 한다(PDR-0004). 예정가격이 아직 관측되지 않은 회차는 축을 옮길 입력이 없어 null이며
  // 그것은 오류가 아니라 판정할 수 없는 상태다(AGENTS 3).
  awardedBidRate: baseRelativeBidRateWireSchema.nullable(),
  dayFloorRate: baseRelativeBidRateWireSchema.nullable(),
  listCount: nonNegativeCountSchema.nullable(),
  // "무효"는 우리가 하는 판정이 아니라 소스의 판정이다(PDR-0002). 우리가 셀 수 있는 것은 그날 하한
  // 미만으로 들어온 명단 행 수뿐이므로 그 사실의 이름을 그대로 쓴다.
  belowDayFloorCount: nonNegativeCountSchema.nullable(),
  winnerSupplierPartyId: positiveBigintTextSchema.nullable(),
  supersedesAttemptId: positiveBigintTextSchema.nullable(),
}).meta({ id: "OrganizationAuctionAttempt", description: "One auction attempt summarized from mart.org_round_summary." });

// 계보 여섯 자리는 공유 value가 소유하고 이 meta는 자기 코호트(표본 수·품목)만 더한다.
export const organizationAuctionAttemptsMetaSchema = martBuildLineageSchema.safeExtend({
  sampleCount: nonNegativeCountSchema,
  // 표본이 어떤 품목으로 좁혀졌는지는 응답만 보고 재현돼야 한다(AGENTS 7). 요청 query의 item을
  // 그대로 되돌려 싣고, 품목을 지정하지 않은 전체 조회는 null이다.
  item: positiveBigintTextSchema.nullable(),
  // 표본이 개찰된 회차로 좁혀졌는지와 그 기준 시각도 응답만으로 재현돼야 한다. `asOf`는 `only`일 때
  // 서버가 비교한 clock 시각이고, `any`는 비교 자체가 없었으므로 null이다 — 없는 기준을 지어내지 않는다.
  opened: organizationAttemptOpenedFilterSchema,
  asOf: instantTextSchema.nullable(),
}).meta({ id: "OrganizationAuctionAttemptsMeta" });

export type OrganizationAuctionAttempt = z.infer<typeof organizationAuctionAttemptSchema>;
export { martCoverageSchema, type MartCoverage } from "../../../values/mart-lineage";
