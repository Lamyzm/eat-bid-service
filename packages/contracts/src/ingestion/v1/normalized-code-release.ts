/** @module 책임: 정부 코드 파일 한 벌을 release 하나로 옮기는 ingestion wire 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../atoms/count";
import { instantTextSchema } from "../../atoms/instant";
import { codeSchemeSchema, sourceCodeSchema, sourceSystemSchema } from "../../atoms/source-code";

export const codeLabelSchema = z.string()
  .min(1)
  .max(512)
  .meta({ id: "CodeLabel", description: "Observed label text for a code value; never an identity." });

// 상위 코드는 문자열이지만 정체성이 아니라 **같은 release 안의 조회 키**다. 투영이 이 문자열로
// 같은 release의 member를 찾아 숫자 id로 바꾸며, 그 뒤로는 어디에서도 문자열을 잇지 않는다.
export const normalizedCodeReleaseMemberV1Schema = z.strictObject({
  scheme: codeSchemeSchema,
  code: sourceCodeSchema,
  label: codeLabelSchema,
  parentCode: sourceCodeSchema.nullable(),
  active: z.boolean(),
  validFrom: instantTextSchema.nullable(),
  validTo: instantTextSchema.nullable(),
}).meta({
  id: "NormalizedCodeReleaseMember",
  description: "One promoted government code row; code text preserves leading zeroes and original width.",
});
export type NormalizedCodeReleaseMemberV1 = z.infer<typeof normalizedCodeReleaseMemberV1Schema>;

export const normalizedCodeReleaseV1Schema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  dataset: z.string().min(1).max(128),
  scheme: codeSchemeSchema,
  sourceVersion: z.string().min(1).max(128),
  publishedAt: instantTextSchema.nullable(),
  // 승격한 grain의 이름과 원본·승격·제외 행 수를 같은 봉투에 싣는다. 무엇을 뺐는지가 release 안에
  // 없으면 빠뜨림이 침묵한다(AGENTS 3, ADR 0035 결정 2).
  promotedGrain: z.array(z.string().min(1).max(64)).min(1).max(8),
  sourceRowCount: nonNegativeCountSchema,
  excludedRowCount: nonNegativeCountSchema,
  members: z.array(normalizedCodeReleaseMemberV1Schema).max(100_000),
}).meta({
  id: "EatbidCodeReleaseV1",
  description: "One sealed government code release with the rows promoted to canonical grain.",
});
export type NormalizedCodeReleaseV1 = z.infer<typeof normalizedCodeReleaseV1Schema>;
