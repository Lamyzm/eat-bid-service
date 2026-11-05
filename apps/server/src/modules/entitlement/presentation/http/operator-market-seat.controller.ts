/** @module 책임: 운영자 시장 자리 목록·주기·연장·회수와 업체 선택지 HTTP 계약을 운영자 인가·use case·공개 응답으로 잇는다. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  operatorMarketSeatV1Operations,
  type ExtendMarketSeatCommand,
  type GrantMarketSeatCommand,
  type MarketSeatCommandResult,
  type OperatorMarketSeatsV1Response,
  type OperatorWorkspacesV1Response,
  type RevokeMarketSeatCommand,
} from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { OperatorGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { AdministerMarketSeats } from "../../application/administer-market-seats";
import { MarketSeatAdminUnavailable, MarketSeatTargetNotFound } from "../../application/market-seat-admin-store";
import {
  toMarketSeatCommandResult,
  toOperatorMarketSeatsResponse,
  toOperatorWorkspacesResponse,
} from "./operator-market-seat.presenter";

const list = operatorMarketSeatV1Operations.listOperatorMarketSeats;
const grant = operatorMarketSeatV1Operations.grantMarketSeat;
const extend = operatorMarketSeatV1Operations.extendMarketSeat;
const revoke = operatorMarketSeatV1Operations.revokeMarketSeat;
const workspaces = operatorMarketSeatV1Operations.listOperatorWorkspaces;

function identifier(raw: string): bigint {
  try {
    // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
    return BigInt(raw);
  } catch {
    throw new BadRequestException({ code: "VALIDATION_ERROR" });
  }
}

function translate(error: unknown): never {
  if (error instanceof MarketSeatTargetNotFound) throw new NotFoundException({ code: "NOT_FOUND" });
  if (error instanceof MarketSeatAdminUnavailable) throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  throw error;
}

/**
 * 운영자 전용이다(ADR 0071 결정 9). 금액 잠금이 자리 확인으로 바뀐 뒤에도 이 화면은 `OperatorGuard`로 남는다. 변경 기록의 행위자는
 * guard가 해소한 principal이다 — 요청 body로 받지 않는다.
 */
@UseGuards(OperatorGuard)
@Controller({ path: list.controllerPath, version: list.version ?? VERSION_NEUTRAL })
export class OperatorMarketSeatController {
  constructor(private readonly administer: AdministerMarketSeats, private readonly runner: EffectRunner) {}

  @Get(list.handlerPath)
  @ApiOperation({ operationId: list.operationId, summary: list.summary })
  @ApiResponse({ status: 200, description: list.successResponses[200].description })
  @ApiResponse({ status: 401, description: list.problemResponses[401].description })
  @ApiResponse({ status: 403, description: list.problemResponses[403].description })
  @ApiResponse({ status: 500, description: list.problemResponses[500].description })
  @ApiResponse({ status: 503, description: list.problemResponses[503].description })
  @ResponseSchema(list.successResponses[200].schema)
  async listSeats(): Promise<OperatorMarketSeatsV1Response> {
    try {
      return toOperatorMarketSeatsResponse(await this.runner.run(this.administer.listSeats()));
    } catch (error) {
      return translate(error);
    }
  }

  @Post(grant.handlerPath)
  @HttpCode(200)
  @ApiOperation({ operationId: grant.operationId, summary: grant.summary })
  @ApiResponse({ status: 200, description: grant.successResponses[200].description })
  @ApiResponse({ status: 400, description: grant.problemResponses[400].description })
  @ApiResponse({ status: 401, description: grant.problemResponses[401].description })
  @ApiResponse({ status: 403, description: grant.problemResponses[403].description })
  @ApiResponse({ status: 404, description: grant.problemResponses[404].description })
  @ApiResponse({ status: 500, description: grant.problemResponses[500].description })
  @ApiResponse({ status: 503, description: grant.problemResponses[503].description })
  @ResponseSchema(grant.successResponses[200].schema)
  async grantSeat(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Body(new StandardSchemaPipe(grant.bodySchema)) body: GrantMarketSeatCommand,
  ): Promise<MarketSeatCommandResult> {
    try {
      return toMarketSeatCommandResult(await this.runner.run(this.administer.grant({
        actorPrincipalId: principal.principalId,
        workspaceId: identifier(body.workspaceId),
        regionCodeValueId: identifier(body.regionCodeValueId),
        item: body.item,
        startDate: Temporal.PlainDate.from(body.startDate),
        months: body.months,
        reason: body.reason,
        memo: body.memo ?? null,
      })));
    } catch (error) {
      return translate(error);
    }
  }

  @Post(extend.handlerPath)
  @HttpCode(200)
  @ApiOperation({ operationId: extend.operationId, summary: extend.summary })
  @ApiResponse({ status: 200, description: extend.successResponses[200].description })
  @ApiResponse({ status: 400, description: extend.problemResponses[400].description })
  @ApiResponse({ status: 401, description: extend.problemResponses[401].description })
  @ApiResponse({ status: 403, description: extend.problemResponses[403].description })
  @ApiResponse({ status: 404, description: extend.problemResponses[404].description })
  @ApiResponse({ status: 500, description: extend.problemResponses[500].description })
  @ApiResponse({ status: 503, description: extend.problemResponses[503].description })
  @ResponseSchema(extend.successResponses[200].schema)
  async extendSeat(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("marketSeatId", new StandardSchemaPipe(extend.pathSchema.shape.marketSeatId)) rawId: string,
    @Body(new StandardSchemaPipe(extend.bodySchema)) body: ExtendMarketSeatCommand,
  ): Promise<MarketSeatCommandResult> {
    try {
      return toMarketSeatCommandResult(await this.runner.run(this.administer.extend({
        actorPrincipalId: principal.principalId,
        marketSeatId: identifier(rawId),
        months: body.months,
        reason: body.reason,
        memo: body.memo ?? null,
      })));
    } catch (error) {
      return translate(error);
    }
  }

  @Post(revoke.handlerPath)
  @HttpCode(200)
  @ApiOperation({ operationId: revoke.operationId, summary: revoke.summary })
  @ApiResponse({ status: 200, description: revoke.successResponses[200].description })
  @ApiResponse({ status: 400, description: revoke.problemResponses[400].description })
  @ApiResponse({ status: 401, description: revoke.problemResponses[401].description })
  @ApiResponse({ status: 403, description: revoke.problemResponses[403].description })
  @ApiResponse({ status: 404, description: revoke.problemResponses[404].description })
  @ApiResponse({ status: 500, description: revoke.problemResponses[500].description })
  @ApiResponse({ status: 503, description: revoke.problemResponses[503].description })
  @ResponseSchema(revoke.successResponses[200].schema)
  async revokeSeat(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("marketSeatId", new StandardSchemaPipe(revoke.pathSchema.shape.marketSeatId)) rawId: string,
    @Body(new StandardSchemaPipe(revoke.bodySchema)) body: RevokeMarketSeatCommand,
  ): Promise<MarketSeatCommandResult> {
    try {
      return toMarketSeatCommandResult(await this.runner.run(this.administer.revoke({
        actorPrincipalId: principal.principalId,
        marketSeatId: identifier(rawId),
        reason: body.reason,
        memo: body.memo ?? null,
      })));
    } catch (error) {
      return translate(error);
    }
  }

  @Get(workspaces.handlerPath)
  @ApiOperation({ operationId: workspaces.operationId, summary: workspaces.summary })
  @ApiResponse({ status: 200, description: workspaces.successResponses[200].description })
  @ApiResponse({ status: 401, description: workspaces.problemResponses[401].description })
  @ApiResponse({ status: 403, description: workspaces.problemResponses[403].description })
  @ApiResponse({ status: 500, description: workspaces.problemResponses[500].description })
  @ApiResponse({ status: 503, description: workspaces.problemResponses[503].description })
  @ResponseSchema(workspaces.successResponses[200].schema)
  async listWorkspaces(): Promise<OperatorWorkspacesV1Response> {
    try {
      return toOperatorWorkspacesResponse(await this.runner.run(this.administer.listWorkspaces()));
    } catch (error) {
      return translate(error);
    }
  }
}
