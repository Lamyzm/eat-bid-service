/** @module 책임: 회차 명단 operation의 입력·응답과 application 실패를 HTTP 상태로 연결한다. */
import { BadRequestException, Controller, Get, NotFoundException, Param, Query, ServiceUnavailableException, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { auctionV1Operations, type AuctionRosterV1Response } from "@eatbid/contracts";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { GetAuctionRoster } from "../../application/get-auction-roster";
import { AuctionDependencyUnavailable, AuctionNotFound } from "../../application/find-auction";
import { auctionId } from "../../domain/auction-id";

const operation = auctionV1Operations.roster;
/**
 * 공고 판단 재료는 로그인해야 열린다. class에 붙이는 이유는 이 controller에 새 handler가 붙을 때
 * decorator를 빠뜨리면 그 하나만 조용히 공개되기 때문이다. 요구 수준은 `provider_session`이라 app
 * 계정 초기화 여부는 보지 않는다(ADR 0032 §5·§12).
 */
@UseGuards(ProviderSessionGuard)
@Controller({ path: operation.controllerPath, version: operation.version ?? VERSION_NEUTRAL })
export class AuctionRosterController {
  constructor(private readonly getRoster: GetAuctionRoster, private readonly runner: EffectRunner) {}
  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 500, description: operation.problemResponses[500].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @Param("auctionId", new StandardSchemaPipe(operation.pathSchema.shape.auctionId)) rawId: string,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: z.output<typeof operation.querySchema>,
  ): Promise<AuctionRosterV1Response> {
    let id: bigint;
    let revisionId: bigint | null;
    try {
      // 양의 bigint 검증 뒤에도 변환 실패는 입력 오류로 닫아 숫자 정밀도 우회 경로를 없앤다.
      id = BigInt(rawId);
      revisionId = query.revisionId === undefined ? null : BigInt(query.revisionId);
    } catch { throw new BadRequestException({ code: "VALIDATION_ERROR" }); }
    try {
      return await this.runner.run(this.getRoster.execute({ auctionId: auctionId(id), revisionId }));
    } catch (error) {
      if (error instanceof AuctionNotFound) throw new NotFoundException({ code: "AUCTION_NOT_FOUND" });
      if (error instanceof AuctionDependencyUnavailable) throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      // 무결성 실패는 503 재시도로 숨기지 않고 전역 결함 필터가 500으로 보고한다.
      throw error;
    }
  }
}
