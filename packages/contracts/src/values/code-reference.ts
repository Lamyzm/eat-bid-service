/** @module 책임: 공개 응답이 외부 코드를 가리킬 때 쓰는 (숫자 id, 코드, 체계, 라벨) 참조 value를 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../atoms/identifier";
import { codeSchemeSchema, sourceCodeSchema } from "../atoms/source-code";

/**
 * 정체성은 `codeValueId` 하나다. `code`는 그 자체로는 식별자가 아니고 `scheme` 안에서만 뜻이 있으며,
 * 두 값을 함께 실어야 화면이 "이 지역 코드가 어느 체계의 것인가"를 다른 응답(분포 meta의
 * `regionScheme`)과 대조할 수 있다(AGENTS 2·6). `label`은 사람이 코드를 확인할 관측 증거일 뿐
 * 조인 키가 아니며, 라벨이 관측되지 않은 코드가 실제로 있으므로 nullable이다.
 *
 * 관측 그대로의 외부 코드를 수신하는 ingestion `SourceCodedValue`와는 방향이 다르다. 저쪽은 아직
 * 내부 id가 없는 입력이고 이쪽은 core에 자리를 잡은 코드의 공개 참조다.
 */
export const codeReferenceSchema = z.strictObject({
  codeValueId: positiveBigintTextSchema,
  code: sourceCodeSchema,
  scheme: codeSchemeSchema,
  label: z.string().min(1).max(256).nullable(),
}).meta({
  id: "CodeReference",
  description: "A public reference to one core code value: numeric identity plus its scheme, code text and optional observed label.",
});

export type CodeReference = z.infer<typeof codeReferenceSchema>;
