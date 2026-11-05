/** @module 책임: v1 운영자 시장 자리 목록·주기·연장·회수와 업체 선택지 operation의 semantic route와 상태별 schema를 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import {
  extendMarketSeatCommandSchema,
  grantMarketSeatCommandSchema,
  marketSeatCommandResultSchema,
  operatorMarketSeatSchema,
  operatorWorkspaceSchema,
  revokeMarketSeatCommandSchema,
} from "./market-seat.resource";

/** 목록 상한이다. 시범 동안은 수십 자리라 페이지를 두지 않는다. 넘으면 페이지를 만든다. */
export const maxOperatorMarketSeats = 500;
export const maxOperatorWorkspaces = 500;

const operatorMarketSeatsV1ResponseSchema = z.strictObject({
  // 지금 쓰는 자리와 끝난 지 30일 안의 자리다. 끝나는 날이 가까운 것부터다.
  seats: z.array(operatorMarketSeatSchema).max(maxOperatorMarketSeats),
  asOf: instantTextSchema,
}).meta({ id: "OperatorMarketSeatsV1Response" });

const operatorWorkspacesV1ResponseSchema = z.strictObject({
  workspaces: z.array(operatorWorkspaceSchema).max(maxOperatorWorkspaces),
}).meta({ id: "OperatorWorkspacesV1Response" });

const marketSeatPathSchema = z.strictObject({ marketSeatId: positiveBigintTextSchema });

/**
 * 운영자 권한(`app.operator_grant`)이 있어야 한다. 없으면 403이다. 금액 잠금과 달리 이 화면은 자리 교체 뒤에도 운영자 전용이다
 * (ADR 0071 결정 9).
 */
const operatorProblems = {
  ...unauthenticatedProblemResponse,
  403: { description: "신뢰하지 않는 Origin 또는 운영자 권한 없음", schema: problemDetailsSchema },
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
} as const;

const commandProblems = {
  ...operatorProblems,
  400: { description: "명령 형식 오류", schema: problemDetailsSchema },
} as const;

export const operatorMarketSeatV1Operations = {
  listOperatorMarketSeats: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "operator", segments: ["market-seats"] },
    operationId: "listOperatorMarketSeats",
    implementationOwner: "server",
    summary: "지금 쓰는 시장 자리와 끝난 지 30일 안의 자리를 업체·사업자번호·변경 기록과 함께 조회한다.",
    tags: ["운영자 시장 자리"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "자리 목록 조회 성공", schema: operatorMarketSeatsV1ResponseSchema },
    },
    problemResponses: operatorProblems,
  }),
  grantMarketSeat: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "operator", segments: ["market-seats"] },
    operationId: "grantMarketSeat",
    implementationOwner: "server",
    summary: "업체에 (참가제한지역, 품목 칸) 자리를 주고 그 업체의 사업자번호를 자리 기간 동안 묶는다."
      + " 저장하지 못하면 이유를 결과로 돌려준다.",
    tags: ["운영자 시장 자리"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: grantMarketSeatCommandSchema,
    successResponses: {
      200: { description: "자리를 주었거나 주지 못한 이유", schema: marketSeatCommandResultSchema },
    },
    problemResponses: { ...commandProblems, 404: { description: "업체가 없음", schema: problemDetailsSchema } },
  }),
  extendMarketSeat: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "operator", segments: ["market-seats", pathParameter("marketSeatId"), "extension"] },
    operationId: "extendMarketSeat",
    implementationOwner: "server",
    summary: "자리의 끝만 개월 수만큼 늘린다. 우선권 시작일은 그대로다.",
    tags: ["운영자 시장 자리"],
    pathSchema: marketSeatPathSchema,
    querySchema: z.undefined(),
    bodySchema: extendMarketSeatCommandSchema,
    successResponses: {
      200: { description: "자리를 늘렸거나 늘리지 못한 이유", schema: marketSeatCommandResultSchema },
    },
    problemResponses: { ...commandProblems, 404: { description: "자리가 없음", schema: problemDetailsSchema } },
  }),
  revokeMarketSeat: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "operator", segments: ["market-seats", pathParameter("marketSeatId"), "revocation"] },
    operationId: "revokeMarketSeat",
    implementationOwner: "server",
    summary: "자리를 지금 시각에서 끝낸다. 행을 지우지 않고 끝을 자르며, 마감 전 공고는 다음 요청에서 다른 후보에게 간다.",
    tags: ["운영자 시장 자리"],
    pathSchema: marketSeatPathSchema,
    querySchema: z.undefined(),
    bodySchema: revokeMarketSeatCommandSchema,
    successResponses: {
      200: { description: "자리를 거뒀거나 거두지 못한 이유", schema: marketSeatCommandResultSchema },
    },
    problemResponses: { ...commandProblems, 404: { description: "자리가 없음", schema: problemDetailsSchema } },
  }),
  listOperatorWorkspaces: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "operator", segments: ["workspaces"] },
    operationId: "listOperatorWorkspaces",
    implementationOwner: "server",
    summary: "자리를 줄 업체를 고르는 선택지다. 업체마다 등록된 사업자번호를 함께 싣는다.",
    tags: ["운영자 시장 자리"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "업체 선택지 조회 성공", schema: operatorWorkspacesV1ResponseSchema },
    },
    problemResponses: operatorProblems,
  }),
} as const;

export const operatorMarketSeatV1OperationRegistry = createOperationRegistry([
  operatorMarketSeatV1Operations.listOperatorMarketSeats,
  operatorMarketSeatV1Operations.grantMarketSeat,
  operatorMarketSeatV1Operations.extendMarketSeat,
  operatorMarketSeatV1Operations.revokeMarketSeat,
  operatorMarketSeatV1Operations.listOperatorWorkspaces,
] as const);

export type OperatorMarketSeatsV1Response = z.infer<typeof operatorMarketSeatsV1ResponseSchema>;
export type OperatorWorkspacesV1Response = z.infer<typeof operatorWorkspacesV1ResponseSchema>;
