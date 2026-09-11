/** @module 책임: 저장 전 지역 선택이 몇 건을 잡는지 묻는 미리보기 command의 입력 계약과 관측 창 길이를 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { maxEligibilityAreaSelection } from "../../../values/eligibility-area";

/**
 * 미리보기가 보는 과거 구간의 길이다. 90일인 이유는 이 화면이 답해야 하는 질문이 "오늘 몇 건"이 아니라
 * "몰리는 날 몇 건"이기 때문이다. 90일 실측에서 공고가 있던 날은 3분의 1이었고 아흐레가 63%를 차지했다
 * (2026-09-11 김해 기준). 한 달로 줄이면 성수기 한 덩어리가 통째로 창 밖에 남고, 일 년으로 늘리면
 * 개편 전 구간이 섞인다.
 */
export const REGION_COVERAGE_WINDOW_DAYS = 90;

/**
 * 아직 저장하지 않은 선택으로 묻는 질문이라 워크스페이스의 저장값을 읽지 않고 코드 목록을 그대로 받는다.
 * 저장 뒤에만 미리볼 수 있으면 "저장 전에 결과를 먼저 보여 준다"는 화면의 약속이 성립하지 않는다.
 *
 * 읽기인데 POST인 이유는 `findMyBidObservations`와 같다 — 코드 목록이 URL query 상한을 넘길 수 있고,
 * 이 답은 링크로 공유할 자원이 아니다.
 */
export const previewRegionCoverageCommandSchema = z.strictObject({
  codeValueIds: z.array(positiveBigintTextSchema).max(maxEligibilityAreaSelection),
}).meta({ id: "PreviewRegionCoverageCommand" });

export type PreviewRegionCoverageCommand = z.input<typeof previewRegionCoverageCommandSchema>;
export type PreviewRegionCoverageCommandInput = z.output<typeof previewRegionCoverageCommandSchema>;
