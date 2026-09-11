/** @module 책임: 참가제한지역 목록 조회와 저장 전 선택 미리보기의 HTTP 계약을 use case와 공개 응답으로 잇는다. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  eligibilityAreaV1Operations,
  type ListEligibilityAreasV1Response,
  type PreviewRegionCoverageCommandInput,
  type RegionCoverageV1Response,
} from "@eatbid/contracts";

import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import { ListEligibilityAreas, PreviewRegionCoverage } from "../../application/preview-region-coverage";
import { toEligibilityAreasResponse, toRegionCoverageResponse } from "./eligibility-area.presenter";

const list = eligibilityAreaV1Operations.listEligibilityAreas;
const preview = eligibilityAreaV1Operations.previewRegionCoverage;

/**
 * 이 둘은 워크스페이스 자료가 아니라 공고 사실의 집계라 `PrincipalGuard`가 아니라 세션만 요구한다.
 * 계정 초기화가 끝나지 않은 사용자도 "내 지역을 고르면 무엇이 보이는지"를 물을 수 있어야 설정 화면이
 * 저장 전에 결과를 보여 줄 수 있다(ADR 0032 §5).
 */
@UseGuards(ProviderSessionGuard)
@Controller({ path: list.controllerPath, version: list.version ?? VERSION_NEUTRAL })
export class EligibilityAreaController {
  constructor(
    private readonly listEligibilityAreas: ListEligibilityAreas,
    private readonly previewRegionCoverage: PreviewRegionCoverage,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(list.handlerPath)
  @ApiOperation({ operationId: list.operationId, summary: list.summary })
  @ApiResponse({ status: 200, description: list.successResponses[200].description })
  @ApiResponse({ status: 401, description: list.problemResponses[401].description })
  @ApiResponse({ status: 503, description: list.problemResponses[503].description })
  @ResponseSchema(list.successResponses[200].schema)
  async list(): Promise<ListEligibilityAreasV1Response> {
    try {
      return toEligibilityAreasResponse(await this.effectRunner.run(this.listEligibilityAreas.execute()));
    } catch (error) {
      throw translate(error);
    }
  }

  @Post(preview.handlerPath)
  @HttpCode(200)
  @ApiOperation({ operationId: preview.operationId, summary: preview.summary })
  @ApiResponse({ status: 200, description: preview.successResponses[200].description })
  @ApiResponse({ status: 400, description: preview.problemResponses[400].description })
  @ApiResponse({ status: 401, description: preview.problemResponses[401].description })
  @ApiResponse({ status: 503, description: preview.problemResponses[503].description })
  @ResponseSchema(preview.successResponses[200].schema)
  async preview(
    @Body(new StandardSchemaPipe(preview.bodySchema)) body: PreviewRegionCoverageCommandInput,
  ): Promise<RegionCoverageV1Response> {
    let codeValueIds: readonly bigint[];
    try {
      codeValueIds = body.codeValueIds.map((value) => BigInt(value));
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toRegionCoverageResponse(
        await this.effectRunner.run(this.previewRegionCoverage.execute({ codeValueIds })),
      );
    } catch (error) {
      throw translate(error);
    }
  }
}

/** use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. */
function translate(error: unknown): never {
  if (error instanceof ProcurementDependencyUnavailable) {
    throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  throw error;
}
