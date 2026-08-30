import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import {
  auctionControllerPath,
  auctionIdPathSchema,
  auctionOperations,
  auctionResponseSchema,
  type AuctionResponse,
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

@Controller(auctionControllerPath)
export class AuctionController {
  constructor(
    private readonly findAuction: FindAuction,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(auctionOperations.find.handlerPath)
  @ApiOperation({
    operationId: auctionOperations.find.operationId,
    summary: auctionOperations.find.summary,
  })
  @ApiParam({
    name: "auctionId",
    required: true,
    example: auctionOperations.find.pathExample,
    schema: { type: "string", pattern: "^[1-9][0-9]*$" },
  })
  @ApiResponse({ status: 200, description: "Canonical auction" })
  @ApiResponse({ status: 400, description: "Invalid auction ID" })
  @ApiResponse({ status: 404, description: "Auction not found" })
  @ApiResponse({ status: 503, description: "Database unavailable" })
  @ResponseSchema(auctionResponseSchema)
  async find(
    @Param("auctionId", new StandardSchemaPipe(auctionIdPathSchema)) rawId: string,
  ): Promise<AuctionResponse> {
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
