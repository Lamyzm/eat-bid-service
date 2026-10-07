/** @module 책임: 추천 투찰가 operation의 운영자 인가·입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import { BadRequestException, Controller, Get, NotFoundException, Param, ServiceUnavailableException, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { auctionV1Operations, type AuctionBidPositionV1Response } from "@eatbid/contracts";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AuctionDependencyUnavailable, AuctionNotFound } from "../../application/find-auction";
import { FindAuctionBidPosition } from "../../application/find-auction-bid-position";
import { auctionId } from "../../domain/auction-id";
import { toAuctionBidPositionResponse } from "./auction-bid-position.presenter";

const operation = auctionV1Operations.bidPosition;

/**
 * 추천 투찰가는 지금 운영자만 본다(ADR 0062). 공고 controller와 나눈 이유는 guard가 다르기 때문이다 — 같은
 * class에 두면 class 단위 guard를 handler마다 바꿔 달아야 하고, 하나를 빠뜨리면 그 handler가 조용히 넓게 열린다.
 */
@UseGuards(OperatorGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class AuctionBidPositionController {
  constructor(private readonly findBidPosition: FindAuctionBidPosition, private readonly runner: EffectRunner) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 403, description: operation.problemResponses[403].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 500, description: operation.problemResponses[500].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @Param("auctionId", new StandardSchemaPipe(operation.pathSchema.shape.auctionId)) rawId: string,
  ): Promise<AuctionBidPositionV1Response> {
    let id: bigint;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      id = BigInt(rawId);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toAuctionBidPositionResponse(await this.runner.run(this.findBidPosition.execute({ auctionId: auctionId(id) })));
    } catch (error) {
      if (error instanceof AuctionNotFound) throw new NotFoundException({ code: "AUCTION_NOT_FOUND" });
      if (error instanceof AuctionDependencyUnavailable) throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      throw error;
    }
  }
}
