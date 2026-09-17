/** @module 책임: v1 세션 조회의 semantic route와 상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { currentSessionV1ResponseSchema } from "./get-current-session.response";

export const sessionV1Operations = {
  getCurrentSession: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "session", segments: [] },
    operationId: "getCurrentSession",
    implementationOwner: "server",
    summary: "현재 요청의 세션 상태를 미로그인·초기화 미완료·활성 셋 중 하나로 조회한다."
      + " 이 조회는 어떤 행도 만들지 않는다.",
    tags: ["내 계정과 조건"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      // 미로그인에서 401을 던지면 진입 화면이 정상 흐름에서 오류를 렌더해야 한다. 세션 조회는
      // "너는 누구인가"의 답이지 보호 자원이 아니다(ADR 0032 §5).
      200: { description: "세션 상태 조회 성공", schema: currentSessionV1ResponseSchema },
    },
    problemResponses: {
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      // 인증 설정이 갖춰지지 않은 배포에서 이 조회가 200 미로그인을 돌려주면 화면은 "로그인하면 된다"고
      // 안내하지만 로그인 자체가 불가능하다. 준비되지 않은 의존성은 그렇게 말한다.
      503: { description: "인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const sessionV1OperationRegistry = createOperationRegistry([
  sessionV1Operations.getCurrentSession,
] as const);
