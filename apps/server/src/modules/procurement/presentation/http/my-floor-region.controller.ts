/** @module 책임: 내 업체 투찰이 가장 많은 공고지역 operation의 운영자 인가·입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { myFloorBidV1Operations, type MyFloorRegionQuery, type MyFloorRegionV1Response } from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import { FindMyFloorRegion, type FindMyFloorRegionInput } from "../../application/find-my-floor-region";
import { kstDate } from "../../domain/kst-day";
import { toMyFloorRegionResponse } from "./my-floor-bids.presenter";

const operation = myFloorBidV1Operations.findMyFloorRegion;

/** 내 사업자 투찰에서 센 값이라 내 투찰 조회와 같은 운영자 게이트를 쓴다(PDR-0008 §2). */
@UseGuards(OperatorGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class MyFloorRegionController {
  constructor(private readonly findMyFloorRegion: FindMyFloorRegion, private readonly runner: EffectRunner) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 403, description: operation.problemResponses[403].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: MyFloorRegionQuery,
  ): Promise<MyFloorRegionV1Response> {
    let input: FindMyFloorRegionInput;
    try {
      input = {
        workspaceId: principal.workspace.workspaceId,
        period: { from: kstDate(query.from), to: kstDate(query.to) },
        floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toMyFloorRegionResponse(await this.runner.run(this.findMyFloorRegion.execute(input)));
    } catch (error) {
      if (error instanceof ProcurementDependencyUnavailable) throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      throw error;
    }
  }
}
