/** @module 책임: 기관 회차 이력 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import type { z } from "zod";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AuctionDependencyUnavailable } from "../../application/find-auction";
import {
  AttemptCursorInvalid,
  ListOrganizationAuctionAttempts,
  OrganizationNotFound,
} from "../../application/list-organization-auction-attempts";
import { organizationId } from "../../domain/organization-id";

const operation = organizationV1Operations.listAuctionAttempts;

type AttemptsQuery = z.output<typeof operation.querySchema>;

@Controller({
  path: operation.controllerPath,
  version: operation.version ?? VERSION_NEUTRAL,
})
export class OrganizationController {
  constructor(
    private readonly listAttempts: ListOrganizationAuctionAttempts,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async list(
    @Param("organizationId", new StandardSchemaPipe(operation.pathSchema.shape.organizationId)) rawId: string,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: AttemptsQuery,
  ): Promise<OrganizationAuctionAttemptsV1Response> {
    let id: bigint;
    let itemCodeValueId: bigint | null;
    let cursor: bigint | null;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      id = BigInt(rawId);
      itemCodeValueId = query.item === undefined ? null : BigInt(query.item);
      cursor = query.cursor === undefined ? null : BigInt(query.cursor);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return await this.effectRunner.run(this.listAttempts.execute({
        organizationId: organizationId(id),
        itemCodeValueId,
        cursor,
        limit: query.limit,
        opened: query.opened,
      }));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof AttemptCursorInvalid) {
        throw new BadRequestException({ code: "VALIDATION_ERROR" });
      }
      if (error instanceof OrganizationNotFound) {
        throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
      }
      if (error instanceof AuctionDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
