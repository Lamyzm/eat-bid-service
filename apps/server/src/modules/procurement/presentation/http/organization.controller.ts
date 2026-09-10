/** @module 책임: 기관 회차 이력 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
import {
  BadRequestException,
  ConflictException,
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
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import type { z } from "zod";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  AttemptAsOfInFuture,
  AttemptBuildChanged,
  AttemptCursorInvalid,
  ListOrganizationAuctionAttempts,
  OrganizationNotFound,
  type ListOrganizationAuctionAttemptsInput,
} from "../../application/list-organization-auction-attempts";
import { organizationId } from "../../domain/organization-id";
import { kstMonth } from "../../domain/kst-month";
import { toOrganizationAttemptsResponse } from "./organization.presenter";

const operation = organizationV1Operations.listAuctionAttempts;

type AttemptsQuery = z.output<typeof operation.querySchema>;

/**
 * 공고 판단 재료는 로그인해야 열린다. class에 붙이는 이유는 이 controller에 새 handler가 붙을 때
 * decorator를 빠뜨리면 그 하나만 조용히 공개되기 때문이다. 요구 수준은 `provider_session`이라 app
 * 계정 초기화 여부는 보지 않는다(ADR 0032 §5·§12).
 */
@UseGuards(ProviderSessionGuard)
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
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 409, description: operation.problemResponses[409].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async list(
    @Param("organizationId", new StandardSchemaPipe(operation.pathSchema.shape.organizationId)) rawId: string,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: AttemptsQuery,
  ): Promise<OrganizationAuctionAttemptsV1Response> {
    let input: ListOrganizationAuctionAttemptsInput;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      input = {
        organizationId: organizationId(BigInt(rawId)),
        itemCodeValueId: query.item === undefined ? null : BigInt(query.item),
        cursor: query.cursor === undefined ? null : BigInt(query.cursor),
        limit: query.limit,
        opened: query.opened,
        includeItemLabel: query.includeItemLabel === "true",
        includeRevision: query.includeRevision === "true",
        expectedBuildId: query.expectedBuildId === undefined ? undefined : BigInt(query.expectedBuildId),
        // 계약이 canonical UTC 문자열임을 이미 확인했으므로 driver 시간 표현을 거치지 않고 바로 닫는다.
        asOf: query.asOf === undefined ? undefined : Temporal.Instant.from(query.asOf),
        floorRate: query.floorRate === undefined || query.floorRate === "all" || query.floorRate === "unknown"
          ? query.floorRate : bidRate(canonicalDecimal(query.floorRate, 3)),
        awardMethodCodeValueId: query.awardMethod === undefined || query.awardMethod === "all" || query.awardMethod === "unknown"
          ? query.awardMethod : BigInt(query.awardMethod),
        period: query.from === undefined || query.to === undefined ? undefined : { from: kstMonth(query.from), to: kstMonth(query.to) },
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      // use case는 내부 record를 돌려주고 wire 직렬화는 presenter가 한다(ADR 0045 결정 1).
      return toOrganizationAttemptsResponse(await this.effectRunner.run(this.listAttempts.execute(input)));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof AttemptCursorInvalid || error instanceof AttemptAsOfInFuture) {
        throw new BadRequestException({ code: "VALIDATION_ERROR" });
      }
      // 같은 build 안의 요청 오류(400)와 build 자체가 사라진 것(409)을 나눠야 화면이 요청을 고칠지
      // 목록 전체를 버리고 다시 조회할지 고를 수 있다.
      if (error instanceof AttemptBuildChanged) {
        throw new ConflictException({ code: "CONFLICT" });
      }
      if (error instanceof OrganizationNotFound) {
        throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
      }
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
