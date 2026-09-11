/** @module 책임: 워크스페이스가 확인한 관심 지역 목록과 그 확인 도장의 공개 표현을 소유한다. */
import { z } from "zod";

import { instantTextSchema } from "../../atoms/instant";
import { eligibilityAreaSchema, maxEligibilityAreaSelection } from "../../values/eligibility-area";

/**
 * 관심 지역은 워크스페이스 하나에 하나다. 사업자는 여럿이어도 배달 다니는 범위는 하나이므로 사업자별로
 * 나누지 않는다(EAT-167 결정 6). 나눌 이유가 실제로 생기면 그때 grain을 쪼갠다.
 *
 * `confirmedAt`이 판정의 중심이다. "값이 있나"가 아니라 "사용자가 확인했나"를 물어야 하기 때문에,
 * 코드를 하나도 고르지 않고 확인만 한 상태(지역으로 좁히지 않겠다는 선택)와 아직 아무것도 묻지 않은
 * 미설정 상태가 서로 다른 값으로 구분된다. 미설정은 오류가 아니라 유효한 상태다(PDR-0001).
 *
 * 저장되는 정체성은 `core.code_value`의 숫자 id 하나이며 라벨은 사람이 확인할 관측 증거다(AGENTS 2).
 * 이 목록이 가리키는 체계는 eaT 참가제한지역이고 행정안전부 canonical이 아니다 — 그 이유와 되돌리기
 * 조건은 ADR 0048이 갖는다.
 */
export const workspaceRegionPreferenceSchema = z.strictObject({
  areas: z.array(eligibilityAreaSchema).max(maxEligibilityAreaSelection),
  confirmedAt: instantTextSchema.nullable(),
}).meta({
  id: "WorkspaceRegionPreference",
  description: "The participation-restriction areas one workspace confirmed, with the instant of that confirmation.",
});

export type WorkspaceRegionPreference = z.infer<typeof workspaceRegionPreferenceSchema>;
