/** @module 책임: 분석 시간축 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
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
import { analysisV1Operations, type AnalysisTimeSeriesV1Response } from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  FindAnalysisTimeSeries,
  type FindAnalysisTimeSeriesInput,
} from "../../application/find-analysis-time-series";
import { OrganizationNotFound } from "../../application/list-organization-auction-attempts";
import { kstDate } from "../../domain/kst-day";
import { organizationId } from "../../domain/organization-id";
import { toAnalysisTimeSeriesResponse } from "./analysis.presenter";

const operation = analysisV1Operations.findTimeSeries;

type TimeSeriesQuery = z.output<typeof operation.querySchema>;

/**
 * 지역 비교는 mart의 공고지역 열이 활성 build에 실린 뒤에 열린다(EAT-198). 그 전까지 요청을 받아 전국으로
 * 조용히 떨어뜨리지 않는 이유는, 화면이 지역을 골랐는데 전국 답을 받으면 그 사실이 응답 어디에도 남지
 * 않기 때문이다. 계약이 이미 허용한 입력이므로 형식 오류가 아니라 아직 답할 수 없는 상태로 끊는다.
 */
class AnalysisRegionScopeUnsupported extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor() {
    super("Region-scoped analysis comparison is not available yet");
    this.name = "AnalysisRegionScopeUnsupported";
  }
}

function inputOf(query: TimeSeriesQuery): FindAnalysisTimeSeriesInput {
  if (query.comparisonScope === "region") throw new AnalysisRegionScopeUnsupported();
  return {
    targetOrganizationId: organizationId(BigInt(query.organizationId)),
    excludeAttemptId: query.excludeAttemptId === undefined ? null : BigInt(query.excludeAttemptId),
    period: { from: kstDate(query.from), to: kstDate(query.to) },
    dateBasis: query.dateBasis,
    comparisonScope: { kind: "national" },
    // scale 불변식은 domain factory가 확인한다. 계약이 3자리를 이미 강제했으므로 여기서 실패하면 계약과
    // 도메인이 갈라진 것이고, 그것은 조용히 넘길 수 없는 결함이다.
    floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
    awardMethodCodeValueId: BigInt(query.awardMethodCodeValueId),
    listCountMin: query.listCountMin ?? null,
    listCountMax: query.listCountMax ?? null,
    targetItemCodeValueId: query.targetItemCodeValueId === undefined
      ? null
      : BigInt(query.targetItemCodeValueId),
  };
}

/**
 * 분석은 로그인해야 열린다. class에 붙이는 이유는 이 controller에 새 handler가 붙을 때 decorator를
 * 빠뜨리면 그 하나만 조용히 공개되기 때문이다. 유료 인가 경계는 EAT-221이 이 자리에 더한다.
 */
@UseGuards(ProviderSessionGuard)
@Controller({
  path: operation.controllerPath,
  version: operation.version ?? VERSION_NEUTRAL,
})
export class AnalysisController {
  constructor(
    private readonly findTimeSeries: FindAnalysisTimeSeries,
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
  async findTimeSeriesHandler(
    @Query(new StandardSchemaPipe(operation.querySchema)) query: TimeSeriesQuery,
  ): Promise<AnalysisTimeSeriesV1Response> {
    let input: FindAnalysisTimeSeriesInput;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 경계 안에서 닫는다.
      input = inputOf(query);
    } catch (error) {
      if (error instanceof AnalysisRegionScopeUnsupported) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      // use case는 내부 record를 돌려주고 wire 직렬화는 presenter가 한다(ADR 0045 결정 1).
      return toAnalysisTimeSeriesResponse(await this.effectRunner.run(this.findTimeSeries.execute(input)));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
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
