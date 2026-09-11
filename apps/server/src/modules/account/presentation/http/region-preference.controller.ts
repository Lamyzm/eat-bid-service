/** @module 책임: 내 워크스페이스 관심 지역의 조회·교체 HTTP 계약을 use case와 공개 응답으로 잇는다. */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  myRegionPreferenceV1Operations,
  type MyRegionPreferenceV1Response,
  type PutMyRegionPreferenceCommandInput,
} from "@eatbid/contracts";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { PrincipalGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { WorkspaceRoleForbidden } from "../../application/account-repository";
import { GetMyRegionPreference, ReplaceMyRegionPreference } from "../../application/manage-region-preference";
import {
  RegionPreferenceAreaUnknown,
  RegionPreferenceDependencyUnavailable,
} from "../../application/region-preference-repository";
import { toMyRegionPreferenceResponse } from "./region-preference.presenter";

const read = myRegionPreferenceV1Operations.getMyRegionPreference;
const replace = myRegionPreferenceV1Operations.putMyRegionPreference;

/** use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. */
function translate(error: unknown): never {
  if (error instanceof RegionPreferenceDependencyUnavailable) {
    throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  if (error instanceof WorkspaceRoleForbidden) throw new ForbiddenException();
  // 어떤 code value가 왜 거절됐는지 본문에 적지 않는다. 그 답은 목록 조회가 준다.
  if (error instanceof RegionPreferenceAreaUnknown) throw new BadRequestException({ code: "VALIDATION_ERROR" });
  throw error;
}

@UseGuards(PrincipalGuard)
@Controller({ path: read.controllerPath, version: read.version ?? VERSION_NEUTRAL })
export class RegionPreferenceController {
  constructor(
    private readonly getMyRegionPreference: GetMyRegionPreference,
    private readonly replaceMyRegionPreference: ReplaceMyRegionPreference,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(read.handlerPath)
  @ApiOperation({ operationId: read.operationId, summary: read.summary })
  @ApiResponse({ status: 200, description: read.successResponses[200].description })
  @ApiResponse({ status: 401, description: read.problemResponses[401].description })
  @ApiResponse({ status: 403, description: read.problemResponses[403].description })
  @ResponseSchema(read.successResponses[200].schema)
  async read(@CurrentPrincipal() principal: ResolvedPrincipal): Promise<MyRegionPreferenceV1Response> {
    try {
      return toMyRegionPreferenceResponse(await this.effectRunner.run(this.getMyRegionPreference.execute(principal)));
    } catch (error) {
      return translate(error);
    }
  }

  @Put(replace.handlerPath)
  @ApiOperation({ operationId: replace.operationId, summary: replace.summary })
  @ApiResponse({ status: 200, description: replace.successResponses[200].description })
  @ApiResponse({ status: 400, description: replace.problemResponses[400].description })
  @ApiResponse({ status: 401, description: replace.problemResponses[401].description })
  @ApiResponse({ status: 403, description: replace.problemResponses[403].description })
  @ResponseSchema(replace.successResponses[200].schema)
  async replace(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Body(new StandardSchemaPipe(replace.bodySchema)) body: PutMyRegionPreferenceCommandInput,
  ): Promise<MyRegionPreferenceV1Response> {
    let codeValueIds: readonly bigint[];
    try {
      codeValueIds = body.codeValueIds.map((value) => BigInt(value));
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toMyRegionPreferenceResponse(
        await this.effectRunner.run(this.replaceMyRegionPreference.execute({ principal, codeValueIds })),
      );
    } catch (error) {
      return translate(error);
    }
  }
}
