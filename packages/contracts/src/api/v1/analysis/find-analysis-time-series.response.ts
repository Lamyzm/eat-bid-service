/** @module 책임: 분석 시간축 조회의 공개 V1 응답 봉투 계약을 소유한다. */
import { z } from "zod";

import { analysisMetaSchema } from "./meta.resource";
import {
  analysisComparisonSeriesSchema,
  analysisTargetPointSchema,
  analysisTimeSeriesAxisSchema,
} from "./time-series.resource";

/**
 * 기관 점과 비교군을 **한 응답**으로 낸다. 둘을 따로 물으면 같은 조건인데 서로 다른 snapshot을 받을 수
 * 있고, `meta`의 교집합 수와 기간 coverage는 두 집단을 동시에 봐야 계산된다(PDR-0006).
 *
 * `meta.state`가 `unavailable`이면 `target`·`comparison`·`axis`가 전부 null이다. **표본 수를 0으로 채우지
 * 않는다** — 관측된 0건과 미발행은 사용자가 할 일이 다르다(AGENTS 3). 자료가 준비됐는데 조건에 맞는
 * 관측이 없는 것은 `ready` + 빈 배열이며 그것도 200이다(ADR 0011·0034).
 *
 * `targetTruncated`는 기관 점이 상한에 걸려 잘렸다는 사실이다. 잘렸으면 화면은 값을 줄여 그리는 대신
 * 범위를 좁히라고 말해야 하고, 그 판단에 필요한 전체 수는 `meta.targetSampleCount`가 갖는다.
 */
export const analysisTimeSeriesV1ResponseSchema = z.strictObject({
  axis: analysisTimeSeriesAxisSchema.nullable(),
  target: z.array(analysisTargetPointSchema).max(8192).nullable(),
  targetTruncated: z.boolean(),
  comparison: analysisComparisonSeriesSchema.nullable(),
  meta: analysisMetaSchema,
}).meta({ id: "EatbidApiV1AnalysisTimeSeries" });

export type AnalysisTimeSeriesV1Response = z.infer<typeof analysisTimeSeriesV1ResponseSchema>;
