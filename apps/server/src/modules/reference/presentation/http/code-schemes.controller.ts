/** @module 책임: 코드 목록 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
import {
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
import { codeSchemeV1Operations, type ListCodesV1Response } from "@eatbid/contracts";
import type { z } from "zod";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import {
  CodeDependencyUnavailable,
  CodeReleaseNotFound,
  ListCodes,
} from "../../application/list-codes";
import { toListCodesResponse } from "./code-schemes.presenter";

const operation = codeSchemeV1Operations.listCodes;

type ListCodesQuery = z.output<typeof operation.querySchema>;

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
export class CodeSchemesController {
  constructor(
    private readonly listCodes: ListCodes,
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
  async list(
    @Param("scheme", new StandardSchemaPipe(operation.pathSchema.shape.scheme)) scheme: string,
    @Query(new StandardSchemaPipe(operation.querySchema)) query: ListCodesQuery,
  ): Promise<ListCodesV1Response> {
    try {
      // use case는 내부 listing을 돌려주고 wire 직렬화는 presenter가 한다(ADR 0045 결정 1).
      return toListCodesResponse(
        scheme,
        await this.effectRunner.run(this.listCodes.execute({ scheme, grain: query.grain ?? null })),
      );
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      // 체계 이름은 자유 문자열이라 자원별 404 코드를 만들지 않는다. 없는 체계는 일반 NOT_FOUND다.
      if (error instanceof CodeReleaseNotFound) {
        throw new NotFoundException({ code: "NOT_FOUND" });
      }
      if (error instanceof CodeDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
