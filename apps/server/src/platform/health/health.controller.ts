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
  liveHealthSchema,
  type LiveHealth,
  readyHealthSchema,
  type ReadyHealth,
} from "@eatbid/contracts";
import { ResponseSchema } from "../http/response-schema.interceptor";
import { DATABASE_READINESS, type DatabaseReadiness, ReadinessState } from "./readiness-state";

@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly readiness: ReadinessState,
    @Inject(DATABASE_READINESS) private readonly database: DatabaseReadiness,
  ) {}

  @Get("live")
  @ApiOperation({ operationId: healthOperations.live.operationId, summary: healthOperations.live.summary })
  @ApiResponse({ status: 200, description: "Process is live" })
  @ResponseSchema(liveHealthSchema)
  live(): LiveHealth {
    return { status: "live" };
  }

  @Get("ready")
  @ApiOperation({ operationId: healthOperations.ready.operationId, summary: healthOperations.ready.summary })
  @ApiResponse({ status: 200, description: "Application is ready" })
  @ApiResponse({ status: 503, description: "Application dependency is unavailable" })
  @ResponseSchema(readyHealthSchema)
  async ready(): Promise<ReadyHealth> {
    if (!this.readiness.ready || !(await this.database.isReady())) {
      throw new ServiceUnavailableException();
    }
    return { status: "ready" };
  }
}
