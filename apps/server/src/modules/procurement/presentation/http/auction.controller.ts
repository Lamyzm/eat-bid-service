/** @module 책임: 공고 조회와 열린 공고 목록 HTTP 계약을 application Effect와 상태별 응답으로 연결한다. */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  auctionV1Operations,
  type AuctionV1Response,
  type OpenAuctionListV1Response,
} from "@eatbid/contracts";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  AuctionDependencyUnavailable,
  AuctionNotFound,
  FindAuction,
} from "../../application/find-auction";
import { ListOpenAuctions, OpenAuctionCursorInvalid } from "../../application/list-open-auctions";
import { auctionId } from "../../domain/auction-id";

const listOperation = auctionV1Operations.listOpen;

type OpenAuctionQuery = z.output<typeof listOperation.querySchema>;

/**
 * 공고 판단 재료는 로그인해야 열린다. class에 붙이는 이유는 이 controller에 새 handler가 붙을 때
 * decorator를 빠뜨리면 그 하나만 조용히 공개되기 때문이다. 요구 수준은 `provider_session`이라 app
 * 계정 초기화 여부는 보지 않는다(ADR 0032 §5·§12).
 */
@UseGuards(ProviderSessionGuard)
@Controller({
  path: auctionV1Operations.find.controllerPath,
  version: auctionV1Operations.find.version ?? VERSION_NEUTRAL,
})
export class AuctionController {
  constructor(
    private readonly findAuction: FindAuction,
    private readonly listOpenAuctions: ListOpenAuctions,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 목록 핸들러를 `:auctionId`보다 먼저 둔다. 패턴이 달라 충돌하지 않지만 읽는 순서를 경로 구체성 순으로 맞춘다.
  @Get(listOperation.handlerPath)
  @ApiOperation({ operationId: listOperation.operationId, summary: listOperation.summary })
  @ApiResponse({ status: 200, description: listOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: listOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: listOperation.problemResponses[401].description })
  @ApiResponse({ status: 503, description: listOperation.problemResponses[503].description })
  @ResponseSchema(listOperation.successResponses[200].schema)
  async listOpen(
    @Query(new StandardSchemaPipe(listOperation.querySchema)) query: OpenAuctionQuery,
  ): Promise<OpenAuctionListV1Response> {
    let regionCodeValueId: bigint | null;
    let cursor: bigint | null;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      regionCodeValueId = query.region === undefined ? null : BigInt(query.region);
      cursor = query.cursor === undefined ? null : BigInt(query.cursor);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return await this.effectRunner.run(this.listOpenAuctions.execute({
        regionCodeValueId,
        itemLabel: query.item ?? null,
        closesWithinHours: query.closesWithinHours ?? null,
        baseAmountMin: query.baseAmountMin ?? null,
        baseAmountMax: query.baseAmountMax ?? null,
        cursor,
        limit: query.limit,
      }));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof OpenAuctionCursorInvalid) {
        throw new BadRequestException({ code: "VALIDATION_ERROR" });
      }
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }

  @Get(auctionV1Operations.find.handlerPath)
  @ApiOperation({
    operationId: auctionV1Operations.find.operationId,
    summary: auctionV1Operations.find.summary,
  })
  @ApiResponse({ status: 200, description: auctionV1Operations.find.successResponses[200].description })
  @ApiResponse({ status: 400, description: auctionV1Operations.find.problemResponses[400].description })
  @ApiResponse({ status: 401, description: auctionV1Operations.find.problemResponses[401].description })
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
