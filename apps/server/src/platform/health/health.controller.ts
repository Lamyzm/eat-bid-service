/** @module 책임: process 생존과 application 준비 상태를 서로 다른 health 계약으로 공개한다. */
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  healthOperations,
  healthControllerPath,
  type LiveHealth,
  type ReadyHealth,
} from "@eatbid/contracts";
import { ResponseSchema } from "../http/response-schema.interceptor";
import type { DatabaseReadiness } from "./readiness-state";
import { ReadinessState } from "./readiness-state";
import { DATABASE_READINESS } from "../database/database.tokens";

@Controller({
  path: healthControllerPath,
  version: healthOperations.live.version ?? VERSION_NEUTRAL,
})
export class HealthController {
  constructor(
    private readonly readiness: ReadinessState,
    @Inject(DATABASE_READINESS) private readonly database: DatabaseReadiness,
  ) {}

  @Get(healthOperations.live.handlerPath)
  @ApiOperation({ operationId: healthOperations.live.operationId, summary: healthOperations.live.summary })
  @ApiResponse({ status: 200, description: healthOperations.live.successResponses[200].description })
  @ResponseSchema(healthOperations.live.successResponses[200].schema)
  live(): LiveHealth {
    // liveness는 외부 의존성 장애로 프로세스 재시작 폭풍을 만들지 않도록 프로세스만 확인한다.
    return { status: "live" };
  }

  @Get(healthOperations.ready.handlerPath)
  @ApiOperation({ operationId: healthOperations.ready.operationId, summary: healthOperations.ready.summary })
  @ApiResponse({ status: 200, description: healthOperations.ready.successResponses[200].description })
  @ApiResponse({ status: 503, description: healthOperations.ready.problemResponses[503].description })
  @ResponseSchema(healthOperations.ready.successResponses[200].schema)
  async ready(): Promise<ReadyHealth> {
    // 종료 중 신규 작업 차단과 DB 최소 권한 검사를 모두 통과해야 readiness를 공개한다.
    if (!this.readiness.ready || !(await this.database.isReady())) {
      throw new ServiceUnavailableException();
    }
    return { status: "ready" };
  }
}
