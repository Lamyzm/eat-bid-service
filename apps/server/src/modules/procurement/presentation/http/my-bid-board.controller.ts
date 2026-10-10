/** @module 책임: 오늘 투찰 operation의 운영자 인가·입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import { Controller, Get, Query, ServiceUnavailableException, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { myBidBoardV1Operations, type MyBidBoardQuery, type MyBidBoardV1Response } from "@eatbid/contracts";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import { GetMyBidBoard } from "../../application/get-my-bid-board";
import { toMyBidBoardResponse } from "./my-bid-board.presenter";

const operation = myBidBoardV1Operations.getMyBidBoard;

/**
 * 맞춤 금액이 실리는 화면이라 추천 투찰가와 같이 운영자만 본다(ADR 0062, PDR-0008). guard가 다른 controller를 섞지 않으려고
 * `me` resource의 다른 controller와 나눈다 — class 단위 guard를 handler마다 바꿔 달다 하나를 빠뜨리면 그 handler가 넓게 열린다.
 */
@UseGuards(OperatorGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class MyBidBoardController {
  constructor(private readonly getMyBidBoard: GetMyBidBoard, private readonly runner: EffectRunner) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 403, description: operation.problemResponses[403].description })
  @ApiResponse({ status: 500, description: operation.problemResponses[500].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: MyBidBoardQuery,
  ): Promise<MyBidBoardV1Response> {
    try {
      return toMyBidBoardResponse(await this.runner.run(this.getMyBidBoard.execute({
        principal,
        itemAtoms: query.items ?? null,
        includeUnknownItem: query.itemUnknown !== undefined,
      })));
    } catch (error) {
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
