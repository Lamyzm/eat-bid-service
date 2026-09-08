/** @module 책임: v1 내 투찰 관측 batch 조회의 semantic route와 상태별 schema 계약을 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { findMyBidObservationsCommandSchema, maxBidObservationAttempts } from "./find-bid-observations.command";
import { myBidObservationsV1ResponseSchema } from "./find-bid-observations.response";

export const myBidObservationV1Operations = {
  /**
   * 읽기인데 POST인 이유: 한 화면이 묻는 회차 조합이 최대 200개라 URL query에 실을 수 없고, 회차마다
   * 명단 endpoint를 부르면 화면 하나가 수십 번의 HTTP 왕복이 된다. 대신 개인 응답의 캐시 금지는
   * method가 아니라 `me` resource prefix의 middleware가 성공·401·403·503 전부에 보장한다.
   *
   * `me` resource에 두는 이유: 이 응답의 범위를 정하는 것은 공고가 아니라 요청자의 워크스페이스가
   * 등록한 사업자다. `auctions` 아래에 두면 공개 회차 자원이 요청자에 따라 다른 내용을 내는 것처럼
   * 보이고, 그 순간 공개 read와 개인 read의 캐시 정책이 같은 경로에 섞인다(ADR 0032 §1).
   */
  findMyBidObservations: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: {
      resource: "me",
      segments: ["businesses", pathParameter("businessId"), "bid-observations"],
    },
    operationId: "findMyBidObservations",
    implementationOwner: "server",
    summary: "내 워크스페이스가 등록한 사업자가 지정한 build·기관의 회차들에 실제로 남긴 투찰 관측을"
      + " 한 번에 조회한다. 원본 대조가 안 된 사업자, 명단에 없는 회차, 명단 자체가 미관측인 회차,"
      + " 증거가 어긋난 회차를 서로 다른 상태로 구분하며 미참여로 단정하지 않는다.",
    tags: ["account"],
    pathSchema: z.strictObject({ businessId: positiveBigintTextSchema }),
    querySchema: z.undefined(),
    bodySchema: findMyBidObservationsCommandSchema,
    successResponses: {
      200: { description: "내 투찰 관측 조회 성공", schema: myBidObservationsV1ResponseSchema },
    },
    problemResponses: {
      400: {
        description: `요청 본문이 유효하지 않거나(회차 ${maxBidObservationAttempts}건 초과·중복 회차 포함)`
          + " 지정한 회차·revision 조합이 그 build와 기관의 mart에 없음",
        schema: problemDetailsSchema,
      },
      401: { description: "유효한 세션이 없음", schema: problemDetailsSchema },
      403: {
        description: "신뢰하지 않는 Origin, 계정 초기화 미완료 또는 다른 워크스페이스의 등록 사업자",
        schema: problemDetailsSchema,
      },
      404: { description: "등록된 사업자를 찾을 수 없음", schema: problemDetailsSchema },
      // 회차 이력의 409와 같은 뜻이다. 소비자는 표와 점을 함께 버리고 처음부터 다시 조회한다.
      409: { description: "지정한 mart build가 더 이상 활성이 아님", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const myBidObservationV1OperationRegistry = createOperationRegistry([
  myBidObservationV1Operations.findMyBidObservations,
] as const);
