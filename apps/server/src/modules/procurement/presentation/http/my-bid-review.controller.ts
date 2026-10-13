/** @module 책임: 내 투찰 복기 operation의 운영자 인가·입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import { Controller, Get, Query, ServiceUnavailableException, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { myBidReviewV1Operations, type MyBidReviewQuery, type MyBidReviewV1Response } from "@eatbid/contracts";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import { GetMyBidReview } from "../../application/get-my-bid-review";
import { toMyBidReviewResponse } from "./my-bid-review.presenter";

const operation = myBidReviewV1Operations.getMyBidReview;

/** 맞춤 금액을 다시 계산해 싣는 화면이라 오늘 투찰처럼 운영자만 본다(ADR 0062, PDR-0008). */
@UseGuards(OperatorGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class MyBidReviewController {
  constructor(private readonly getMyBidReview: GetMyBidReview, private readonly runner: EffectRunner) {}

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
    @Query(new StandardSchemaPipe(operation.querySchema)) query: MyBidReviewQuery,
  ): Promise<MyBidReviewV1Response> {
    try {
      return toMyBidReviewResponse(await this.runner.run(this.getMyBidReview.execute({
        workspaceId: principal.workspace.workspaceId,
        month: query.month ?? null,
      })));
    } catch (error) {
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
