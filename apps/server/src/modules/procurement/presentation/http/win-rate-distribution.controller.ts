/** @module 책임: 낙찰률 분포 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
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
import {
  winRateDistributionV1Operations,
  type WinRateDistributionV1Response,
} from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AuctionDependencyUnavailable } from "../../application/find-auction";
import {
  DistributionBinWidthInvalid,
  DistributionRegionNotFound,
  FindWinRateDistribution,
  type FindWinRateDistributionInput,
} from "../../application/find-win-rate-distribution";
import { OrganizationNotFound } from "../../application/list-organization-auction-attempts";
import type { DistributionCohort } from "../../domain/distribution-cohort";
import { kstMonth } from "../../domain/kst-month";
import { organizationId } from "../../domain/organization-id";

const operation = winRateDistributionV1Operations.find;

type DistributionQuery = z.output<typeof operation.querySchema>;

/**
 * 계약의 `.check()`가 이미 축의 짝을 강제했지만 타입은 그 사실을 모른다. 여기서 판별 union으로
 * 좁혀야 "전국인데 지역 id가 있는" 값이 어댑터까지 내려갈 수 없다는 것이 타입으로도 닫힌다.
 */
function cohortOf(query: DistributionQuery): DistributionCohort {
  if (query.scope === "organization") {
    if (query.organizationId === undefined) throw new BadRequestException({ code: "VALIDATION_ERROR" });
    return { scope: "organization", organizationId: organizationId(BigInt(query.organizationId)) };
  }
  if (query.scope === "national") return { scope: "national" };
  if (query.regionCodeValueId === undefined) throw new BadRequestException({ code: "VALIDATION_ERROR" });
  return { scope: query.scope, regionCodeValueId: BigInt(query.regionCodeValueId) };
}

function inputOf(query: DistributionQuery): FindWinRateDistributionInput {
  return {
    cohort: cohortOf(query),
    // scale 불변식은 domain factory가 확인한다. 계약이 3자리를 이미 강제했으므로 여기서 실패하면
    // 계약과 도메인이 갈라진 것이고, 그것은 조용히 넘길 수 없는 결함이다.
    floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
    awardMethodCodeValueId: BigInt(query.awardMethod),
    binWidth: bidRate(canonicalDecimal(query.binWidth, 3)),
    granularity: query.granularity,
    period: query.from === undefined || query.to === undefined
      ? null
      : { from: kstMonth(query.from), to: kstMonth(query.to) },
  };
}

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
export class WinRateDistributionController {
  constructor(
    private readonly findDistribution: FindWinRateDistribution,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @Query(new StandardSchemaPipe(operation.querySchema)) query: DistributionQuery,
  ): Promise<WinRateDistributionV1Response> {
    let input: FindWinRateDistributionInput;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      input = inputOf(query);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return await this.effectRunner.run(this.findDistribution.execute(input));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof DistributionBinWidthInvalid) {
        throw new BadRequestException({ code: "VALIDATION_ERROR" });
      }
      if (error instanceof OrganizationNotFound) {
        throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
      }
      // 지역 코드값은 자원별 404 allowlist에 없다. 없는 지역은 일반 NOT_FOUND로 닫는다.
      if (error instanceof DistributionRegionNotFound) {
        throw new NotFoundException({ code: "NOT_FOUND" });
      }
      if (error instanceof AuctionDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
