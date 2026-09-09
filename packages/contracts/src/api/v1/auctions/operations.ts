/** @module 책임: v1 공고 조회·열린 목록·회차 명단의 semantic route와 상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { auctionIdPathSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { auctionV1ResponseSchema } from "./get-auction.response";
import { auctionRosterV1ResponseSchema } from "./get-auction-roster.response";
import { auctionRosterQuerySchema } from "./get-auction-roster.query";
import { DEFAULT_OPEN_AUCTION_LIMIT, openAuctionListQuerySchema } from "./list-open-auctions.query";
import { openAuctionListV1ResponseSchema } from "./list-open-auctions.response";

export const auctionV1Operations = {
  roster: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "auctions", segments: [pathParameter("auctionId"), "roster"] },
    operationId: "getAuctionRoster",
    implementationOwner: "server",
    summary: "공고 회차의 실제 참여 명단을 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({ auctionId: auctionIdPathSchema }),
    querySchema: auctionRosterQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "관측 명단 또는 미관측 상태", schema: auctionRosterV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "공고 또는 revision ID가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "공고와 일치하는 revision을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "명단 무결성 또는 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
  // 목록에는 "없는 자원"이 없어 404를 두지 않는다. cursor가 활성 build에 없을 때만 400이며, 남의
  // cursor·사라진 cursor를 빈 페이지로 위장하면 호출자가 "끝"과 "잘못된 요청"을 구분하지 못한다.
  // 401은 guard가 붙는 변경에서 함께 선언한다 — 서버가 절대 내지 않는 응답을 적으면 계약이 거짓말한다.
  listOpen: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "auctions", segments: [] },
    operationId: "listOpenAuctions",
    implementationOwner: "server",
    summary: "열린 공고를 마감 임박 순으로 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({}),
    querySchema: openAuctionListQuerySchema.default({ state: "open", limit: DEFAULT_OPEN_AUCTION_LIMIT }),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "열린 공고 목록 조회 성공", schema: openAuctionListV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "query가 유효하지 않음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
  find: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "auctions", segments: [pathParameter("auctionId")] },
    operationId: "findAuction",
    implementationOwner: "server",
    summary: "정규화된 공고를 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({ auctionId: auctionIdPathSchema }),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "정규화된 공고 조회 성공", schema: auctionV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "공고 ID가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "공고를 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const auctionV1OperationRegistry = createOperationRegistry([
  auctionV1Operations.roster,
  auctionV1Operations.listOpen,
  auctionV1Operations.find,
] as const);
