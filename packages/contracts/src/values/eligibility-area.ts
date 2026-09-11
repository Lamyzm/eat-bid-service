/** @module 책임: eaT 참가제한지역 코드가 공개 계약에서 갖는 참조 형태와 한 요청이 실을 수 있는 코드 수 상한을 소유한다. */
import { z } from "zod";

import { codeReferenceSchema } from "./code-reference";

/**
 * 참가제한지역 코드 하나의 공개 참조다. `codeReferenceSchema`를 그대로 쓰되 이름을 따로 두는 이유는,
 * 이 축이 공고지역(`eat:auction-location-*`)이나 행정안전부 코드와 **다른 체계**이기 때문이다.
 * 같은 모양이라고 같은 뜻으로 읽으면 그것이 규칙 6이 금지하는 체계 혼용이다. 어느 체계인지는 값의
 * `scheme`이 스스로 말한다.
 */
export const eligibilityAreaSchema = codeReferenceSchema
  .meta({
    id: "EligibilityArea",
    description: "One eaT participation-restriction area code reference with its scheme, code text and optional observed label.",
  });

/**
 * 한 요청이 실을 수 있는 참가제한지역 코드 수의 상한이다.
 *
 * 이 값은 사용자의 선택 폭을 좁히는 상한이 아니다. 실측에서 실제로 투찰한 공고의 제한지역이 중앙값 11개,
 * 상위 10% 28개, 최대 58개였고(2026-09-11 활발한 공급업체 200곳), 체계 전체 코드 수도 186개다. 그보다
 * 크게 잡아 두어야 "10개까지만"류의 상한이 시군구로 쪼개진 지역의 업체를 처음부터 배제하는 일이 없다
 * (EAT-167 결정 4). 그럼에도 상한 자체를 두는 이유는 배열 길이가 없는 계약이 응답 크기와 질의 파라미터
 * 수를 열어 두기 때문이다.
 */
export const maxEligibilityAreaSelection = 200;

export type EligibilityArea = z.infer<typeof eligibilityAreaSchema>;
