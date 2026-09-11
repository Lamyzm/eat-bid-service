/** @module 책임: v1 내 워크스페이스 관심 지역의 조회·통째 교체 command의 semantic route와 상태별 schema 계약을 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { workspaceRegionPreferenceSchema } from "../../../resources/account/region-preference";
import { maxEligibilityAreaSelection } from "../../../values/eligibility-area";
import { createOperationRegistry, defineOperation } from "../../operation";

const myRegionPreferenceV1ResponseSchema = z.strictObject({
  preference: workspaceRegionPreferenceSchema,
}).meta({ id: "MyRegionPreferenceV1Response" });

/**
 * 부분 갱신을 만들지 않는다. 지역 하나를 더하고 빼는 command를 열면 화면이 여러 요청으로 목록을 만들게
 * 되고, 그 사이의 실패가 "사용자가 확인한 목록"이라는 사실을 반쪽 상태로 남긴다. 확인 도장은 이 교체가
 * 성공할 때 찍히므로 목록과 확인이 언제나 같은 시점의 사실이다(EAT-167 outcome 1).
 *
 * 빈 배열도 유효한 요청이다. "지역으로 좁히지 않겠다"는 확인된 선택이며 미설정과 다른 상태다.
 */
const putMyRegionPreferenceCommandSchema = z.strictObject({
  codeValueIds: z.array(positiveBigintTextSchema).max(maxEligibilityAreaSelection),
}).meta({ id: "PutMyRegionPreferenceCommand" });

const forbiddenProblem = {
  403: {
    description: "신뢰하지 않는 Origin, 계정 초기화 미완료 또는 owner 권한 부족",
    schema: problemDetailsSchema,
  },
} as const;

const preferenceProblems = {
  ...unauthenticatedProblemResponse,
  ...forbiddenProblem,
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
} as const;

export const myRegionPreferenceV1Operations = {
  getMyRegionPreference: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["region-preference"] },
    operationId: "getMyRegionPreference",
    implementationOwner: "server",
    summary: "내 워크스페이스가 확인한 관심 지역 목록과 확인 시각을 조회한다."
      + " 아직 확인하지 않은 워크스페이스는 빈 목록과 null 확인 시각을 받는다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "관심 지역 조회 성공", schema: myRegionPreferenceV1ResponseSchema },
    },
    problemResponses: preferenceProblems,
  }),
  putMyRegionPreference: defineOperation({
    method: "put",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["region-preference"] },
    operationId: "putMyRegionPreference",
    implementationOwner: "server",
    summary: "내 워크스페이스의 관심 지역 목록을 통째로 교체하고 확인 시각을 찍는다."
      + " owner만 바꿀 수 있고 참가제한지역 체계에 없는 코드는 거절한다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: putMyRegionPreferenceCommandSchema,
    successResponses: {
      200: { description: "관심 지역 교체 성공", schema: myRegionPreferenceV1ResponseSchema },
    },
    problemResponses: {
      // 없는 코드와 다른 체계의 코드를 404가 아니라 400으로 답한다. 자원이 없는 것이 아니라 이 command가
      // 받지 않는 값이며, 어떤 code value가 어느 체계에 있는지를 응답으로 알려 주지도 않는다.
      400: {
        description: `요청 본문이 유효하지 않거나(코드 ${maxEligibilityAreaSelection}건 초과·중복 코드 포함)`
          + " 참가제한지역 체계에 없는 code value를 포함함",
        schema: problemDetailsSchema,
      },
      ...preferenceProblems,
    },
  }),
} as const;

export const myRegionPreferenceV1OperationRegistry = createOperationRegistry([
  myRegionPreferenceV1Operations.getMyRegionPreference,
  myRegionPreferenceV1Operations.putMyRegionPreference,
] as const);

export { myRegionPreferenceV1ResponseSchema, putMyRegionPreferenceCommandSchema };

export type MyRegionPreferenceV1Response = z.infer<typeof myRegionPreferenceV1ResponseSchema>;
export type PutMyRegionPreferenceCommand = z.input<typeof putMyRegionPreferenceCommandSchema>;
export type PutMyRegionPreferenceCommandInput = z.output<typeof putMyRegionPreferenceCommandSchema>;
