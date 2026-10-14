/** @module 책임: 하한선 자리(PDR-0009) HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
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
  floorLineV1Operations,
  type FloorLineRegionsQuery,
  type FloorLineRegionsV1Response,
  type FloorLinesQuery,
  type FloorLinesV1Response,
} from "@eatbid/contracts";
import { bidRate, canonicalDecimal } from "@eatbid/domain";

import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AnalysisRegionNotFound } from "../../application/analysis-axes";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  FindFloorLineRegions,
  FindFloorLines,
  type FindFloorLineRegionsInput,
  type FindFloorLinesInput,
} from "../../application/find-floor-lines";
import { kstDate } from "../../domain/kst-day";
import { toFloorLineRegionsResponse, toFloorLinesResponse } from "./floor-lines.presenter";

const regionsOperation = floorLineV1Operations.findRegions;
const linesOperation = floorLineV1Operations.findFloorLines;

function periodAndRate(query: { from: string; to: string; floorRate: string }): FindFloorLineRegionsInput {
  return {
    period: { from: kstDate(query.from), to: kstDate(query.to) },
    // 계약이 소수 셋째 자리를 강제했다. 여기서 실패하면 계약과 도메인이 갈라진 결함이다.
    floorRate: bidRate(canonicalDecimal(query.floorRate, 3)),
  };
}

function translate(error: unknown): unknown {
  // 지역 코드값은 자원별 404 allowlist에 없어 분석 조회와 같은 일반 NOT_FOUND로 닫는다.
  if (error instanceof AnalysisRegionNotFound) return new NotFoundException({ code: "NOT_FOUND" });
  if (error instanceof ProcurementDependencyUnavailable) return new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  return error;
}

/**
 * 하한선 자리는 시장 조회라 로그인만 요구한다(분석 조회와 같은 경계). class에 붙이는 이유는 새 handler가 decorator를
 * 빠뜨려 조용히 공개되지 않게 하기 위해서다. 내 사업자 투찰을 겹치는 개인 조회는 `me` resource가 따로 맡는다(ADR 0032 §1).
 */
@UseGuards(ProviderSessionGuard)
@Controller({ path: linesOperation.controllerPath, version: linesOperation.version ?? VERSION_NEUTRAL })
export class FloorLinesController {
  constructor(
    private readonly findLines: FindFloorLines,
    private readonly findRegions: FindFloorLineRegions,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 고정 경로 `floor-lines/regions`를 먼저 둔다. 같은 prefix의 handler 순서가 registry 순서와 같아야 한다.
  @Get(regionsOperation.handlerPath)
  @ApiOperation({ operationId: regionsOperation.operationId, summary: regionsOperation.summary })
  @ApiResponse({ status: 200, description: regionsOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: regionsOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: regionsOperation.problemResponses[401].description })
  @ApiResponse({ status: 503, description: regionsOperation.problemResponses[503].description })
  @ResponseSchema(regionsOperation.successResponses[200].schema)
  async findRegionsHandler(
    @Query(new StandardSchemaPipe(regionsOperation.querySchema)) query: FloorLineRegionsQuery,
  ): Promise<FloorLineRegionsV1Response> {
    let input: FindFloorLineRegionsInput;
    try {
      input = periodAndRate(query);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toFloorLineRegionsResponse(await this.effectRunner.run(this.findRegions.execute(input)));
    } catch (error) {
      throw translate(error);
    }
  }

  @Get(linesOperation.handlerPath)
  @ApiOperation({ operationId: linesOperation.operationId, summary: linesOperation.summary })
  @ApiResponse({ status: 200, description: linesOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: linesOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: linesOperation.problemResponses[401].description })
  @ApiResponse({ status: 404, description: linesOperation.problemResponses[404].description })
  @ApiResponse({ status: 503, description: linesOperation.problemResponses[503].description })
  @ResponseSchema(linesOperation.successResponses[200].schema)
  async findLinesHandler(
    @Query(new StandardSchemaPipe(linesOperation.querySchema)) query: FloorLinesQuery,
  ): Promise<FloorLinesV1Response> {
    let input: FindFloorLinesInput;
    try {
      input = {
        ...periodAndRate(query),
        sigunguCodeValueId: BigInt(query.regionCodeValueId),
        includeLadders: query.include === "ranks",
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toFloorLinesResponse(await this.effectRunner.run(this.findLines.execute(input)));
    } catch (error) {
      throw translate(error);
    }
  }
}
