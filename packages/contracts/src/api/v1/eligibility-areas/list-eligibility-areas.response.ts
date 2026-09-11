/** @module 책임: 참가제한지역 선택 목록 조회의 공개 V1 응답 봉투와 라벨 결측을 드러내는 meta 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { codeSchemeSchema } from "../../../atoms/source-code";
import { eligibilityAreaGroupSchema } from "./eligibility-area.resource";

/**
 * 라벨이 관측되지 않은 코드 수를 숨기지 않는다. 화면이 그 코드를 코드 문자열로 부르게 되므로 몇 개가
 * 그런 상태인지가 사용자가 볼 사실이다(AGENTS 3·7). 이 목록은 `core.code_release`가 아니라 관측된
 * code value에서 오므로 release 계보를 실을 자리가 없다 — 그 이유는 ADR 0048이 갖는다.
 */
export const listEligibilityAreasMetaSchema = z.strictObject({
  areaCount: nonNegativeCountSchema,
  unlabeledAreaCount: nonNegativeCountSchema,
}).meta({ id: "EatbidApiV1ListEligibilityAreasMeta" });

export const listEligibilityAreasV1ResponseSchema = z.strictObject({
  scheme: codeSchemeSchema,
  groups: z.array(eligibilityAreaGroupSchema).max(64),
  meta: listEligibilityAreasMetaSchema,
}).meta({ id: "EatbidApiV1ListEligibilityAreas" });

export type ListEligibilityAreasMeta = z.infer<typeof listEligibilityAreasMetaSchema>;
export type ListEligibilityAreasV1Response = z.infer<typeof listEligibilityAreasV1ResponseSchema>;
