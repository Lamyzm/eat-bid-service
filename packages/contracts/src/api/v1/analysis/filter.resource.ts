/** @module 책임: 기관과 eaT 공고지역·전국 분석이 공유하는 적용 필터의 wire 형태를 소유한다. */
import { z } from "zod";
import { CODE_SCHEME_NAMES } from "../../../atoms/code-scheme-names";
import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { bidRateWireSchema } from "../../../values/rate";

export const analysisDateBasisSchema = z.enum(["opened", "announced"]);
// 참가제한·행안부 지역은 같은 ID 형태여도 이 분석 축의 값이 아니다.
export const analysisRegionSchemeSchema = z.enum([
  CODE_SCHEME_NAMES.auctionLocationSido, CODE_SCHEME_NAMES.auctionLocationSigungu,
]);
export const analysisPeriodSchema = z.strictObject({
  from: kstDateTextSchema,
  to: kstDateTextSchema,
}).meta({ id: "AnalysisPeriod", description: "양끝 포함 KST 날짜. 실제 달력일과 역전 여부는 의미 parser에서 검증한다." });

export const analysisComparisonScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("national") }),
  z.strictObject({ kind: z.literal("region"), scheme: analysisRegionSchemeSchema, codeValueId: positiveBigintTextSchema }),
]);
/**
 * 품목 조건이다. **비교하는 모든 집단에 같게 걸린다**(PDR-0007). 기관 점만 거르고 비교군은 전체 품목이던
 * 규칙(PDR-0006)을 대체한다 — 조건 막대가 `육류`라고 말하면서 구름이 전체 품목을 그리면 두 집단이 다른
 * 질문에 답한다.
 *
 * 값은 `eatbid:auction-item` 원자다. 코드값 id가 아닌 이유는 오늘 화면이 이미 같은 어휘를 원자로 받고
 * 있고(`itemsFilterSchema`), 원자 여덟은 계약 안에 있어 화면이 사전을 따로 묻지 않아도 되기 때문이다.
 *
 * `unknown`은 **품목 다리 행이 없는 회차**다. 원천이 품목을 말하지 않은 것이며 우리가 못 읽은 것이
 * 아니다(2026-09-18 운영 실측: 전체의 33.4%, `build_vocabulary_gap` 0행). 3분의 1이 걸린 값이라 자동으로
 * 넣지도 빼지도 않고 고르게 한다(AGENTS 3).
 */
export const analysisItemFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({
    kind: z.literal("atoms"),
    atoms: z.array(auctionItemAtomSchema).min(1).max(AUCTION_ITEM_ATOMS.length),
    unknown: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
/**
 * 같은 그림에 겹쳐 찍을 다른 기관이다. **비교조건이 아니라 표시 축이다** — 이 값은 모집단을 바꾸지
 * 않고 점만 더한다(PDR-0007). 비교조건에 넣으면 기관을 고를 때마다 표본 수가 흔들린다.
 *
 * 여섯이 상한인 이유는 색과 자리다. 시안 루프 실측에서 그보다 많으면 고리가 기관 점을 덮었다.
 */
export const analysisOverlayOrganizationIdsSchema = z.array(positiveBigintTextSchema).max(6);

export const analysisListCountRangeSchema = z.strictObject({
  min: nonNegativeCountSchema.nullable(),
  max: nonNegativeCountSchema.nullable(),
}).meta({ id: "AnalysisListCountRange", description: "철회 행 포함 관측 명단 크기. 양끝 포함, null 경계는 제한 없음." });

/** 날짜 기준은 기간과 X축에 함께 적용한다. 품목은 기관·비교군·겹쳐 찍은 기관에 같게 적용한다(PDR-0007). */
export const analysisFilterValueSchema = z.strictObject({
  targetOrganizationId: positiveBigintTextSchema,
  excludeAttemptId: positiveBigintTextSchema.nullable(),
  period: analysisPeriodSchema,
  dateBasis: analysisDateBasisSchema,
  comparisonScope: analysisComparisonScopeSchema,
  floorRate: bidRateWireSchema,
  awardMethodCodeValueId: positiveBigintTextSchema,
  listCountRange: analysisListCountRangeSchema,
  itemFilter: analysisItemFilterSchema,
  overlayOrganizationIds: analysisOverlayOrganizationIdsSchema,
}).meta({ id: "AnalysisFilterValue" });

export type AnalysisFilterValue = z.infer<typeof analysisFilterValueSchema>;
export type AnalysisPeriod = z.infer<typeof analysisPeriodSchema>;
