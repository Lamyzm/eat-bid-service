/** @module 책임: 하한선 자리 화면(PDR-0009)이 읽는 공고별 하한선 점·1~10등 사다리·규칙 분포·지역 목록 resource를 정의한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { baseRelativeBidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { moneyWireSchema } from "../../../values/money";
import { baseRelativeBidRateWireSchema, bidRateWireSchema } from "../../../values/rate";
import { analysisPeriodSchema } from "./filter.resource";

/**
 * 기초금액 대비율 여러 개다. 단위를 값마다 붙이면 공고 하나에 열 번, 화면 하나에 수만 번 같은 말을 싣게 되어
 * 단위를 목록에 한 번만 둔다. 분모는 이름에 박는다 — 예정가격 대비 투찰률과 섞이면 같은 90.0이 다른 뜻이 된다.
 */
export const baseRelativeBidRateListSchema = z.strictObject({
  unit: z.literal("percentage-points"),
  denominator: z.literal("base-amount"),
  values: z.array(baseRelativeBidRateTextSchema).max(400),
}).meta({ id: "BaseRelativeBidRateList", description: "기초금액 대비 % 값 목록. 단위와 분모를 목록에 한 번만 둔다." });

/**
 * 공고 하나의 하한선이다. 하한선은 관측이 아니라 그날 예정가격 × 하한율로 정해진 파생값이다(PDR-0002). 그래서
 * 기초금액 대비율과 함께 그 분모인 기초금액을 싣는다 — 화면이 원 단위로 바꿔 말할 때 다시 묻지 않게 한다.
 * 기관 이름은 관측 라벨이라 없을 수 있고, 없다고 점을 빼지 않는다(AGENTS 3).
 */
export const floorLinePointSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  openedAt: instantTextSchema,
  organizationName: z.string().min(1).max(256).nullable(),
  baseAmount: moneyWireSchema,
  floor: baseRelativeBidRateWireSchema,
}).meta({ id: "FloorLinePoint" });

/**
 * 공고 하나에서 하한 위로 낸 업체를 낮은 순으로 열 곳까지 세운 사다리다. 업체마다 가장 낮게 낸 값 하나만 센다.
 * `validBidderCount`는 하한 위로 낸 업체 전체 수라 "n곳 중 k등"의 n이다. 명단이 관측되지 않은 회차는 사다리가 없다.
 */
export const floorLineLadderSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  validBidderCount: nonNegativeCountSchema,
  lowest: baseRelativeBidRateListSchema,
}).meta({ id: "FloorLineLadder" });

/**
 * 하한선이 떨어지는 자리의 분포다. eaT 예비가격 추첨(기초금액 ±3% 15개 중 많이 뽑힌 4개 평균)이 정하는 예정가격
 * 분포에 하한율을 곱한 것이며, 맞춤 금액·복기의 추첨 평균 기대가 쓰는 **같은 분포 판**이다 — 두 벌로 두면 화면마다
 * 하한선 확률이 미세하게 달라진다. 예측이 아니라 제도가 정한 모양이고, 화면은 이것으로 점 20개·하한 미달 확률·추첨만
 * 돌린 한 달을 그린다(PDR-0009). 판이 바뀌면 같은 공고의 확률도 바뀌므로 판과 근거 공고 수를 늘 함께 싣는다(AGENTS 7).
 *
 * `quantiles`는 확률 0.005부터 0.995까지 0.005 간격의 199개 분위수이며 이 하한율의 하한선 기초금액 대비율이다.
 */
export const floorLineRuleSchema = z.strictObject({
  version: kstDateTextSchema,
  sourceRounds: nonNegativeCountSchema,
  quantiles: baseRelativeBidRateListSchema,
}).meta({ id: "FloorLineRule" });

/** 고른 공고지역 시군구다. 이름은 관측 라벨이라 없을 수 있다. */
export const floorLineRegionRefSchema = z.strictObject({
  codeValueId: positiveBigintTextSchema,
  label: z.string().min(1).max(64).nullable(),
}).meta({ id: "FloorLineRegionRef" });

/**
 * 응답이 무엇을 기준으로 셌는지다. 점은 mart build 하나에서 읽고, 사다리는 같은 회차의 명단을 core에서 읽는다
 * — 명단은 mart에 없고, 개찰 뒤 명단은 바뀌지 않으므로 build와 어긋날 일이 회차 단위로 닫힌다.
 */
export const floorLinesMetaSchema = z.strictObject({
  build: martBuildLineageSchema,
  region: floorLineRegionRefSchema,
  period: analysisPeriodSchema,
  floorRate: bidRateWireSchema,
  pointCount: nonNegativeCountSchema,
}).meta({ id: "FloorLinesMeta" });

/** 시도 하나와 그 안의 시군구다. 건수는 같은 하한율·기간에서 하한선이 계산되는 공고 수다. */
export const floorLineRegionGroupSchema = z.strictObject({
  sido: floorLineRegionRefSchema,
  sigungu: z.array(z.strictObject({
    region: floorLineRegionRefSchema,
    pointCount: nonNegativeCountSchema,
  })).max(400),
}).meta({ id: "FloorLineRegionGroup" });
