/** @module 책임: 하한선 자리에 겹칠 내 사업자 투찰 operation의 운영자 인가·입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { myFloorBidV1Operations, type MyFloorBidsQuery, type MyFloorBidsV1Response } from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AnalysisRegionNotFound } from "../../application/analysis-axes";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import { FindMyFloorBids, type FindMyFloorBidsInput } from "../../application/find-my-floor-bids";
import { kstDate } from "../../domain/kst-day";
import { toMyFloorBidsResponse } from "./my-floor-bids.presenter";

const operation = myFloorBidV1Operations.findMyFloorBids;

/** 내 사업자 투찰과 등수를 싣는 화면이라 복기·오늘 투찰처럼 운영자만 본다(PDR-0008 §2, PDR-0009). */
@UseGuards(OperatorGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class MyFloorBidsController {
  constructor(private readonly findMyFloorBids: FindMyFloorBids, private readonly runner: EffectRunner) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 403, description: operation.problemResponses[403].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: MyFloorBidsQuery,
  ): Promise<MyFloorBidsV1Response> {
    let input: FindMyFloorBidsInput;
    try {
      input = {
        workspaceId: principal.workspace.workspaceId,
        sigunguCodeValueId: BigInt(query.regionCodeValueId),
        period: { from: kstDate(query.from), to: kstDate(query.to) },
        floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toMyFloorBidsResponse(await this.runner.run(this.findMyFloorBids.execute(input)));
    } catch (error) {
      if (error instanceof AnalysisRegionNotFound) throw new NotFoundException({ code: "NOT_FOUND" });
      if (error instanceof ProcurementDependencyUnavailable) throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      throw error;
    }
  }
}
