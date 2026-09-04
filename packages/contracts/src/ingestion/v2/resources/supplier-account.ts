/** @module 책임: 명단 행이 가리키는 출처 범위 공급자 계정을 관측 상태 그대로 담는 계약을 소유한다. */
import { z } from "zod";

import { sourceSystemSchema } from "../../../atoms/source-code";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 사업자번호는 대조 키이지 정체성이 아니다(domain-and-data §3.3). SupplierParty로의 승격은 projector가
// 별도 정책으로 하며 정규화 단계는 관측된 계정 코드와 사업자번호를 나란히 보존만 한다.
export const normalizedSupplierAccountSchema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  accountCode: sourceCodedValueSchema,
  businessNumber: sourceCodedValueSchema.nullable(),
}).meta({
  id: "NormalizedSupplierAccount",
  description: "Observed source-scoped supplier account; neither code is an internal identity.",
});

export type NormalizedSupplierAccount = z.infer<typeof normalizedSupplierAccountSchema>;
