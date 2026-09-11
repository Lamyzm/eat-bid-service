/** @module 책임: 참가제한지역 선택 화면이 그리는 시도 묶음 하나의 공개 표현을 소유한다. */
import { z } from "zod";

import { eligibilityAreaSchema, maxEligibilityAreaSelection } from "../../../values/eligibility-area";

/**
 * 한 시도의 묶음이다. `all`은 그 시도 전체로 열린 공고를 가리키는 코드이고 `parts`는 같은 시도 아래
 * 관측된 시군구 코드들이다. 둘을 한 배열로 합치지 않는 이유는 매칭 규칙이 서로 다르기 때문이다 —
 * 시군구를 고르면 그 시도의 `all`이 자동으로 함께 잡히지만 반대는 성립하지 않는다(ADR 0048 결정 2).
 * 화면이 `전체` 칩을 다른 칩과 나란히 보이면서도 그 차이를 문구로 말할 수 있어야 한다.
 *
 * 묶음의 정체성은 `all.codeValueId`다. 묶음 이름을 따로 싣지 않는 이유는 그 이름이 곧 `all`의 관측
 * 라벨이고, 라벨을 다시 조립하면 선언이 둘이 되기 때문이다(AGENTS 2, ADR 0035).
 */
export const eligibilityAreaGroupSchema = z.strictObject({
  all: eligibilityAreaSchema,
  parts: z.array(eligibilityAreaSchema).max(maxEligibilityAreaSelection),
}).meta({
  id: "EligibilityAreaGroup",
  description: "One eaT participation-restriction sido group: its whole-sido code and the sigungu codes observed under it.",
});

export type EligibilityAreaGroup = z.infer<typeof eligibilityAreaGroupSchema>;
