/** @module 책임: 세션 조회 HTTP 계약을 application Effect와 상태별 공개 응답으로 연결한다. */
import { Controller, Get, Req, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { sessionV1Operations, type CurrentSessionV1Response } from "@eatbid/contracts";
import type { Request } from "express";
import { webHeadersOf } from "../../../../platform/auth/request-headers";
import { AuthDependencyUnavailable } from "../../../../platform/auth/session-authenticator";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { AccountDependencyUnavailable } from "../../application/account-repository";
import { GetCurrentSession } from "../../application/get-current-session";
import { toCurrentSessionResponse } from "./account.presenter";

const operation = sessionV1Operations.getCurrentSession;

@Controller({
  path: operation.controllerPath,
  version: operation.version ?? VERSION_NEUTRAL,
})
export class SessionController {
  constructor(
    private readonly getCurrentSession: GetCurrentSession,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 이 조회에는 guard를 걸지 않는다. 세션 조회는 "너는 누구인가"의 답이지 보호 자원이 아니고, 401을
  // 던지면 진입 화면이 정상 흐름에서 오류를 렌더해야 한다(ADR 0032 §5).
  @Get(operation.handlerPath)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async read(@Req() request: Request): Promise<CurrentSessionV1Response> {
    try {
      // use case는 판정 record를 돌려주고 표시 라벨·wire 직렬화는 presenter가 한다(ADR 0045 결정 1).
      return toCurrentSessionResponse(await this.effectRunner.run(this.getCurrentSession.execute(webHeadersOf(request))));
    } catch (error) {
      if (error instanceof AuthDependencyUnavailable || error instanceof AccountDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
