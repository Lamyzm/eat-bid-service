/** @module 책임: 분석 전체 개찰 이력 조회의 공개 V1 응답 봉투 계약을 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { analysisHistoryMetaSchema, analysisHistoryRowSchema } from "./history.resource";

/**
 * 한 페이지다. `nextCursor`가 null이면 끝이다. 자료가 아직 없으면(활성 build 없음) `meta`는 그대로 오고
 * `rows`는 빈 배열이며 `totalCount`가 0이다 — 활성 build가 없다는 사실은 `meta.build.buildId`가 null로 말한다.
 */
export const analysisHistoryV1ResponseSchema = z.strictObject({
  rows: z.array(analysisHistoryRowSchema).max(200),
  nextCursor: positiveBigintTextSchema.nullable(),
  meta: analysisHistoryMetaSchema,
}).meta({ id: "EatbidApiV1AnalysisHistory" });

export type AnalysisHistoryV1Response = z.infer<typeof analysisHistoryV1ResponseSchema>;
