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
import {
  analysisV1Operations,
  type AnalysisConditionOptionsV1Response,
  type AnalysisTimeSeriesV1Response,
} from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import type { AnalysisItemFilter } from "../../application/analysis-time-series-reader";
import {
  AnalysisRegionNotFound,
  FindAnalysisTimeSeries,
  type FindAnalysisTimeSeriesInput,
} from "../../application/find-analysis-time-series";
import {
  FindAnalysisConditionOptions,
  type FindAnalysisConditionOptionsInput,
} from "../../application/find-analysis-condition-options";
import { OrganizationNotFound } from "../../application/list-organization-auction-attempts";
import { kstDate } from "../../domain/kst-day";
import { organizationId } from "../../domain/organization-id";
import { toAnalysisConditionOptionsResponse } from "./analysis-condition-options.presenter";
import { toAnalysisTimeSeriesResponse } from "./analysis.presenter";

const operation = analysisV1Operations.findTimeSeries;
const optionsOperation = analysisV1Operations.findConditionOptions;

type TimeSeriesQuery = z.output<typeof operation.querySchema>;
type ConditionOptionsQuery = z.output<typeof optionsOperation.querySchema>;

/**
 * 계약의 `.check()`가 이미 모집단과 지역 축의 짝을 강제했지만 타입은 그 사실을 모른다. 여기서 판별
 * union으로 좁혀야 "지역인데 체계가 없는" 값이 어댑터까지 내려갈 수 없다는 것이 타입으로도 닫힌다.
 */
function comparisonScopeOf(
  query: Pick<TimeSeriesQuery, "comparisonScope" | "comparisonRegionScheme" | "comparisonRegionCodeValueId">,
): FindAnalysisTimeSeriesInput["comparisonScope"] {
  if (query.comparisonScope === "national") return { kind: "national" };
  if (query.comparisonRegionScheme === undefined || query.comparisonRegionCodeValueId === undefined) {
    throw new BadRequestException({ code: "VALIDATION_ERROR" });
  }
  return {
    kind: "region",
    scheme: query.comparisonRegionScheme,
    codeValueId: BigInt(query.comparisonRegionCodeValueId),
  };
}

/**
 * 평평한 query 두 칸을 품목 조건 하나로 접는다. 계약의 `.check()`가 이미 `only`와 원자가 함께 오지
 * 못하게 막았지만 타입은 그 사실을 모르므로, 여기서 판별 union으로 좁혀야 두 뜻이 섞인 값이 어댑터까지
 * 내려갈 수 없다는 것이 타입으로도 닫힌다.
 */
function itemFilterOf(query: Pick<TimeSeriesQuery, "items" | "itemUnknown">): AnalysisItemFilter {
  if (query.itemUnknown === "only") return { kind: "unknown" };
  if (query.items === undefined) return { kind: "all" };
  return { kind: "atoms", atoms: query.items, unknown: query.itemUnknown === "include" };
}

function inputOf(query: TimeSeriesQuery): FindAnalysisTimeSeriesInput {
  return {
    targetOrganizationId: organizationId(BigInt(query.organizationId)),
    excludeAttemptId: query.excludeAttemptId === undefined ? null : BigInt(query.excludeAttemptId),
    period: { from: kstDate(query.from), to: kstDate(query.to) },
    dateBasis: query.dateBasis,
    comparisonScope: comparisonScopeOf(query),
    // scale 불변식은 domain factory가 확인한다. 계약이 3자리를 이미 강제했으므로 여기서 실패하면 계약과
    // 도메인이 갈라진 것이고, 그것은 조용히 넘길 수 없는 결함이다.
    floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
    awardMethodCodeValueId: BigInt(query.awardMethodCodeValueId),
    listCountMin: query.listCountMin ?? null,
    listCountMax: query.listCountMax ?? null,
    itemFilter: itemFilterOf(query),
    overlayOrganizationIds: (query.overlayOrganizationIds ?? []).map((value) => BigInt(value)),
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
    private readonly findConditionOptions: FindAnalysisConditionOptions,
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
    } catch {
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
      // 지역 코드값은 자원별 404 allowlist에 없다. 없는 지역은 일반 NOT_FOUND로 닫는다.
      if (error instanceof AnalysisRegionNotFound) {
        throw new NotFoundException({ code: "NOT_FOUND" });
      }
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }

  @Get(optionsOperation.handlerPath)
  @ApiOperation({ operationId: optionsOperation.operationId, summary: optionsOperation.summary })
  @ApiResponse({ status: 200, description: optionsOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: optionsOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: optionsOperation.problemResponses[401].description })
  @ApiResponse({ status: 404, description: optionsOperation.problemResponses[404].description })
  @ApiResponse({ status: 503, description: optionsOperation.problemResponses[503].description })
  @ResponseSchema(optionsOperation.successResponses[200].schema)
  async findConditionOptionsHandler(
    @Query(new StandardSchemaPipe(optionsOperation.querySchema)) query: ConditionOptionsQuery,
  ): Promise<AnalysisConditionOptionsV1Response> {
    let input: FindAnalysisConditionOptionsInput;
    try {
      input = optionsInputOf(query);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toAnalysisConditionOptionsResponse(
        await this.effectRunner.run(this.findConditionOptions.execute(input)),
      );
    } catch (error) {
      throw translate(error);
    }
  }
}

/**
 * use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. 두 handler가
 * 같은 실패를 내므로 번역도 한 곳에서 한다 — 두 벌이면 한쪽만 고쳐져 같은 실패가 다른 상태로 나간다.
 */
function translate(error: unknown): unknown {
  if (error instanceof OrganizationNotFound) return new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
  // 지역 코드값은 자원별 404 allowlist에 없다. 없는 지역은 일반 NOT_FOUND로 닫는다.
  if (error instanceof AnalysisRegionNotFound) return new NotFoundException({ code: "NOT_FOUND" });
  if (error instanceof ProcurementDependencyUnavailable) {
    return new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  return error;
}

function optionsInputOf(query: ConditionOptionsQuery): FindAnalysisConditionOptionsInput {
  return {
    targetOrganizationId: organizationId(BigInt(query.organizationId)),
    excludeAttemptId: query.excludeAttemptId === undefined ? null : BigInt(query.excludeAttemptId),
    period: { from: kstDate(query.from), to: kstDate(query.to) },
    dateBasis: query.dateBasis,
    comparisonScope: comparisonScopeOf(query),
    floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
    awardMethodCodeValueId: BigInt(query.awardMethodCodeValueId),
    listCountMin: query.listCountMin ?? null,
    listCountMax: query.listCountMax ?? null,
    itemFilter: itemFilterOf(query),
    sido: query.sido === undefined ? null : BigInt(query.sido),
    organizationQuery: query.organizationQuery ?? null,
  };
}
