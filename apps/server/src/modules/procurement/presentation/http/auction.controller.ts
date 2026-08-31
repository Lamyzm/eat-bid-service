import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  auctionV1Operations,
  type AuctionV1Response,
} from "@eatbid/contracts";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import {
  AuctionDependencyUnavailable,
  AuctionNotFound,
  FindAuction,
} from "../../application/find-auction";
import { auctionId } from "../../domain/auction-id";

@Controller({
  path: auctionV1Operations.find.controllerPath,
  version: auctionV1Operations.find.version ?? VERSION_NEUTRAL,
})
export class AuctionController {
  constructor(
    private readonly findAuction: FindAuction,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(auctionV1Operations.find.handlerPath)
  @ApiOperation({
    operationId: auctionV1Operations.find.operationId,
    summary: auctionV1Operations.find.summary,
  })
  @ApiResponse({ status: 200, description: auctionV1Operations.find.successResponses[200].description })
  @ApiResponse({ status: 400, description: auctionV1Operations.find.problemResponses[400].description })
  @ApiResponse({ status: 404, description: auctionV1Operations.find.problemResponses[404].description })
  @ApiResponse({ status: 503, description: auctionV1Operations.find.problemResponses[503].description })
  @ResponseSchema(auctionV1Operations.find.successResponses[200].schema)
  async find(
    @Param("auctionId", new StandardSchemaPipe(auctionV1Operations.find.pathSchema.shape.auctionId)) rawId: string,
  ): Promise<AuctionV1Response> {
    let id: bigint;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      id = BigInt(rawId);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return await this.effectRunner.run(this.findAuction.execute({ auctionId: auctionId(id) }));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof AuctionNotFound) {
        throw new NotFoundException({ code: "AUCTION_NOT_FOUND" });
      }
      if (error instanceof AuctionDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
