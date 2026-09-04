/** @module 책임: 외부 코드를 (source_system, code_scheme, code)로 수신하는 관측 value 계약을 소유한다. */
import { z } from "zod";

import { codeSchemeSchema, sourceCodeSchema, sourceSystemSchema } from "../atoms/source-code";

// 왜 label을 같이 싣나. 원본 라벨은 코드의 의미를 사람이 확인할 증거이지 정체성이 아니다. 라벨로
// 조인하거나 라벨을 상태로 승격하지 않는다(AGENTS 2·3). 라벨이 비어 오는 코드가 있으므로 nullable이다.
export const sourceCodedValueSchema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  codeScheme: codeSchemeSchema,
  code: sourceCodeSchema,
  label: z.string().min(1).max(256).nullable(),
}).meta({
  id: "SourceCodedValue",
  description: "One observed external code with its scheme, source system and optional source label.",
});

export type SourceCodedValue = z.infer<typeof sourceCodedValueSchema>;
