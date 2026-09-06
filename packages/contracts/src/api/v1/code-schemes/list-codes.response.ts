/** @module 책임: 코드 체계별 지역 코드 목록 조회의 공개 V1 응답 봉투 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { codeSchemeSchema } from "../../../atoms/source-code";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { regionCodeV1Schema } from "../../../values/region-code";

// 응답이 어느 release를 읽었는지를 함께 싣는다. 지역 목록은 release가 바뀌면 통째로 바뀌므로
// 소비자가 "언제의 구역인가"를 묻지 못하면 개편 전후 화면이 같은 것처럼 보인다(ADR 0035).
export const listCodesMetaSchema = z.strictObject({
  codeReleaseId: positiveBigintTextSchema,
  sourceVersion: z.string().min(1).max(128),
  publishedAt: instantTextSchema.nullable(),
  promotedGrain: z.array(z.string().min(1).max(64)).min(1).max(8),
  // 좌표가 없는 코드 수를 숨기지 않는다. 지도에 서지 않는 구가 몇 개인지가 화면의 사실이다.
  codesWithoutCoordinateCount: nonNegativeCountSchema,
}).meta({ id: "EatbidApiV1ListCodesMeta" });
export type ListCodesMeta = z.infer<typeof listCodesMetaSchema>;

export const listCodesV1ResponseSchema = z.strictObject({
  scheme: codeSchemeSchema,
  codes: z.array(regionCodeV1Schema).max(1000),
  meta: listCodesMetaSchema,
}).meta({ id: "EatbidApiV1ListCodes" });
export type ListCodesV1Response = z.infer<typeof listCodesV1ResponseSchema>;
