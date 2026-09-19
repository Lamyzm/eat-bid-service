/** @module 책임: 분석 시간축 조회가 싣는 기관 실제 점과 비교군 관측 밀도의 공개 표현을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { observedBidRateWireSchema } from "../../../values/rate";
import { analysisPeriodSchema } from "./filter.resource";

/**
 * 기관의 실제 낙찰점 하나다. **회차 하나가 관측 하나**이며 명단 행 수만큼 복제하지 않는다(PDR-0006).
 * 재입찰은 독립 attempt라 같은 공고의 두 시도가 두 점으로 선다.
 *
 * `attemptId`와 `revisionId`를 함께 싣는 이유는 점을 눌렀을 때 그 회차의 참여 업체로 건너가야 하고,
 * 어느 해석에서 읽은 값인지가 없으면 그 점을 원본에서 재현할 수 없기 때문이다(AGENTS 7).
 * 값은 사정률이다. 기초금액을 분모로 쓰는 투찰률과 같은 축에 놓지 않는다(PDR-0004).
 */
export const analysisTargetPointSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  /** 이 점이 X축에서 서는 시각이다. 어느 날짜를 쓸지는 필터의 `dateBasis`가 정한다. */
  plottedAt: instantTextSchema,
  assessmentRate: observedBidRateWireSchema,
}).meta({ id: "AnalysisTargetPoint" });

/**
 * 비교군 밀도 칸 하나다. 시간 구간과 사정률 구간이 만나는 자리의 관측 수다.
 *
 * **화면 pixel 좌표가 아니라 의미 있는 구간이다.** 픽셀을 API로 보내면 창 크기가 코호트를 바꾸고,
 * 같은 질문의 답이 화면마다 달라진다(EAT-216 범위).
 *
 * 두 축 모두 반개구간 `[from, to)`이다. 경계가 닫힌 쪽을 한 번 정해 두지 않으면 같은 관측이 이웃 칸에
 * 두 번 세어지거나 어느 칸에도 안 들어간다.
 */
export const analysisDensityCellSchema = z.strictObject({
  fromAt: instantTextSchema,
  toAt: instantTextSchema,
  rateFrom: observedBidRateWireSchema,
  rateTo: observedBidRateWireSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "AnalysisDensityCell" });

/**
 * 비교군이 무엇으로 오는지다. 좁은 범위에서는 실제 점이, 넓은 범위에서는 밀도가 온다.
 *
 * 둘을 한 배열로 합치지 않는 이유는 사용자가 할 일이 다르기 때문이다. 점은 눌러서 그 회차로 건너가고
 * 밀도 칸은 눌러서 범위를 좁힌다. 한 모양으로 접으면 화면이 무엇을 눌렀는지 모른 채 둘 중 하나를 고르게 된다.
 *
 * `truncated`는 상한에 걸려 잘렸다는 사실이다. **임의로 잘라 놓고 전체인 척하지 않는다** — 표본 수는
 * `AnalysisMeta`가 따로 말하므로 화면이 "몇 개 중 몇 개를 그렸는지"를 알 수 있다(AGENTS 3·7).
 */
export const analysisComparisonSeriesSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("points"),
    points: z.array(analysisTargetPointSchema).max(8192),
    truncated: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("density"),
    cells: z.array(analysisDensityCellSchema).max(32768),
    truncated: z.boolean(),
  }),
]).meta({ id: "AnalysisComparisonSeries" });

/**
 * 시간축의 눈금이다. 서버가 실제로 적용한 구간이며 요청이 준 희망값이 아니다 — 요청한 해상도를 그대로
 * 되돌려 주면 화면이 자기가 보낸 값을 확인할 뿐이고, 서버가 상한 때문에 거칠게 잡았다는 사실이 사라진다.
 */
/**
 * 겹쳐 찍은 기관 하나의 점 묶음이다. 기관마다 따로 싣는 이유는 화면이 색과 번호를 기관 단위로 주기
 * 때문이다 — 한 배열에 섞어 보내면 화면이 다시 기관별로 갈라야 하고 그 갈래가 서버와 어긋날 수 있다.
 *
 * `name`은 관측 라벨이라 없을 수 있다. 이름이 없다고 묶음을 빼면 사용자가 고른 기관이 그림에서
 * 조용히 사라진다(AGENTS 3).
 */
export const analysisOverlaySeriesSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  name: z.string().min(1).max(256).nullable(),
  points: z.array(analysisTargetPointSchema).max(2048),
  truncated: z.boolean(),
}).meta({ id: "AnalysisOverlaySeries" });

export const analysisTimeResolutionSchema = z.enum(["day", "week", "month"]);

export const analysisTimeSeriesAxisSchema = z.strictObject({
  period: analysisPeriodSchema,
  timeResolution: analysisTimeResolutionSchema,
  /** 밀도 칸의 사정률 폭이다. 비교군이 점으로 올 때는 칸이 없으므로 null이다. */
  rateBinWidth: observedBidRateWireSchema.nullable(),
}).meta({ id: "AnalysisTimeSeriesAxis" });

export type AnalysisOverlaySeries = z.infer<typeof analysisOverlaySeriesSchema>;
export type AnalysisTargetPoint = z.infer<typeof analysisTargetPointSchema>;
export type AnalysisDensityCell = z.infer<typeof analysisDensityCellSchema>;
export type AnalysisComparisonSeries = z.infer<typeof analysisComparisonSeriesSchema>;
export type AnalysisTimeSeriesAxis = z.infer<typeof analysisTimeSeriesAxisSchema>;
