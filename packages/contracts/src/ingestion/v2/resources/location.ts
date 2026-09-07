/** @module 책임: v2 위치 블록에 참가제한지역 코드의 관측 라벨을 봉인된 바이트를 흔들지 않는 가산 필드로 싣는 계약을 소유한다. */
import { z } from "zod";

import { sourceCodedValueSchema } from "../../../values/source-coded-value";
import { normalizedLocationSchema } from "../../v1/resources/location";

/**
 * `eligibilityCodes`는 봉인된 identity 목록 그대로 두고, 같은 순서의 `(코드, 라벨)` 관측을 optional로
 * 얹는다. 라벨을 코드 옆에 두는 이유는 행안부 매핑의 유일한 입력이 `PDLC_NM` 이름 경로이기 때문이며
 * (ADR 0035 결정 6), optional인 이유는 이 필드가 생기기 전에 봉인된 v2 payload가 producer가 쓴 키만
 * 재직렬화하는 규칙으로 바이트 그대로 남아야 하기 때문이다(ADR 0037). 키가 없는 것은 "관측하지 않은
 * parser version"이고, 빈 배열은 "참가제한지역이 없는 공고"다. 두 사실을 null 하나로 접지 않는다.
 */
export const normalizedLocationV2Schema = normalizedLocationSchema.safeExtend({
  eligibilityAreas: z.array(sourceCodedValueSchema).max(512).optional(),
}).meta({
  id: "NormalizedLocationV2",
  description:
    "Observed source-scoped location codes plus, when the parser version observes them, the eligibility codes with their source labels in the same order as eligibilityCodes.",
});

export type NormalizedLocationV2 = z.infer<typeof normalizedLocationV2Schema>;
