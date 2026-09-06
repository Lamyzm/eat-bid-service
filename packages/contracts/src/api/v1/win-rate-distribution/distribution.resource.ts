/** @module 책임: 낙찰 사정률 분포의 칸·최빈 구간·달 행과 그 응답 meta resource 계약을 소유한다. */
import { z } from "zod";

import { kstMonthTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { martBuildLineageSchema, martCoverageSchema } from "../../../values/mart-lineage";
import { bidRateWireSchema, observedBidRateWireSchema, ratioWireSchema } from "../../../values/rate";

// mart의 `distributionScopes`와 같은 이름을 쓴다. 이름이 두 벌이면 DB check 제약과 계약 중 어느 쪽이
// 모집단의 권위인지 알 수 없다.
export const distributionScopeSchema = z.enum(["national", "province", "district", "organization"])
  .meta({ id: "WinRateDistributionScope", description: "Population the distribution counts over." });

/**
 * 반개구간 `[from, to)`의 낙찰 횟수다. 경계가 `ObservedBidRate`인 이유는 사정률에 100을 넘는 관측이
 * 있기 때문이다(단가입찰 코호트). 0~100으로 닫힌 `BidRate`를 쓰면 관측을 담을 수 없다(AGENTS 3).
 */
export const distributionBinSchema = z.strictObject({
  from: observedBidRateWireSchema,
  to: observedBidRateWireSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "WinRateDistributionBin", description: "Half-open assessment-rate bin [from, to) and its win count." });

/**
 * 중앙값은 점이 아니라 칸이다. 우리가 가진 것은 칸별 횟수뿐이라 `90.033` 같은 점을 내면 없는
 * 정밀도를 만든다. 정렬된 표본의 `floor(n / 2)`번째(0-based) 관측이 속한 칸이다.
 */
export const binBoundarySchema = z.strictObject({
  from: observedBidRateWireSchema,
  to: observedBidRateWireSchema,
}).meta({ id: "WinRateDistributionBinBoundary", description: "Half-open assessment-rate interval without a count." });

/**
 * 최빈 칸에서 양쪽으로 이웃 칸의 횟수가 최빈의 절반 이상인 동안 확장한 연속 구간이다. `share`는
 * 그 구간 합을 표본 수로 나눈 비율이며 percentage-points가 아니라 ratio 축이다(AGENTS 15).
 */
export const modeRangeSchema = binBoundarySchema.safeExtend({
  count: nonNegativeCountSchema,
  share: ratioWireSchema,
}).meta({ id: "WinRateDistributionModeRange", description: "Contiguous interval around the modal bin with its share of the sample." });

/**
 * `bins`가 `null`인 것은 "칸이 없다"가 아니라 "이 요청이 달별 칸을 요청하지 않았다"는 뜻이다
 * (`granularity=total`). 달 행 자체는 `granularity`와 무관하게 늘 실려야 각주가 어느 달이
 * 수집되지 않았는지 말할 수 있다.
 */
export const distributionMonthSchema = z.strictObject({
  month: kstMonthTextSchema,
  sampleCount: nonNegativeCountSchema,
  coverage: martCoverageSchema.nullable(),
  bins: z.array(distributionBinSchema).max(4096).nullable(),
}).meta({ id: "WinRateDistributionMonth", description: "One KST month of the requested cohort." });

export const distributionPeriodSchema = z.strictObject({
  from: kstMonthTextSchema,
  to: kstMonthTextSchema,
}).meta({ id: "WinRateDistributionPeriod", description: "Inclusive KST month range the sample was counted over." });

/**
 * 응답만 보고 표본을 재현할 수 있어야 하므로(AGENTS 7) 코호트 전부와 기간을 되돌려 싣는다.
 * 표본 부족 라벨(n<10 부족, 10≤n<30 적음)은 넣지 않는다. 그 임계값은 관측 사실이 아니라 제품
 * 판단이며, 서버가 실으면 모든 미래 소비자가 그 판단을 물려받는다(AGENTS 8).
 */
export const winRateDistributionMetaSchema = martBuildLineageSchema.safeExtend({
  sampleCount: nonNegativeCountSchema,
  // 품목 축은 분포 mart에 아직 없다. 그래도 자리를 비워 두지 않고 늘 null을 실어 "품목으로 좁히지
  // 않은 표본"임을 화면이 말하게 한다. EAT-66이 품목 CodeScheme을 만들면 이 자리에 id가 들어온다.
  item: positiveBigintTextSchema.nullable(),
  scope: distributionScopeSchema,
  regionCodeValueId: positiveBigintTextSchema.nullable(),
  organizationId: positiveBigintTextSchema.nullable(),
  // 하한율과 칸 폭은 0~100으로 닫힌 축이고 칸 경계는 그렇지 않다. 두 축을 한 wire 계약으로 묶지 않는다.
  floorRate: bidRateWireSchema,
  awardMethod: positiveBigintTextSchema,
  binWidth: bidRateWireSchema,
  period: distributionPeriodSchema,
}).meta({ id: "WinRateDistributionMeta" });

export type DistributionScope = z.infer<typeof distributionScopeSchema>;
export type DistributionBin = z.infer<typeof distributionBinSchema>;
export type WinRateDistributionMeta = z.infer<typeof winRateDistributionMetaSchema>;
