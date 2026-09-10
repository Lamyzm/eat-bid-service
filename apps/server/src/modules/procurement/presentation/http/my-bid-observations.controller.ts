/** @module 책임: 내 투찰 관측 batch 조회의 HTTP 계약을 세션 판정·application Effect·공개 응답으로 잇는다. */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
  myBidObservationV1Operations,
  type FindMyBidObservationsCommand,
  type MyBidObservationsV1Response,
} from "@eatbid/contracts";
import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { PrincipalGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import {
  RegisteredBusinessForbidden,
  RegisteredBusinessNotFound,
} from "../../../account/application/account-repository";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  FindMyBidObservations,
  OwnBidAttemptsNotInBuild,
  OwnBidBuildChanged,
  type FindMyBidObservationsInput,
} from "../../application/find-my-bid-observations";
import { organizationId } from "../../domain/organization-id";

const operation = myBidObservationV1Operations.findMyBidObservations;

@Controller({
  path: operation.controllerPath,
  version: operation.version ?? VERSION_NEUTRAL,
})
export class MyBidObservationsController {
  constructor(
    private readonly findMyBidObservations: FindMyBidObservations,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 읽기이므로 201이 아니라 200이다. POST인 이유는 계약이 소유한다.
  @Post(operation.handlerPath)
  @HttpCode(200)
  @UseGuards(PrincipalGuard)
  @ApiOperation({ operationId: operation.operationId, summary: operation.summary })
  @ApiResponse({ status: 200, description: operation.successResponses[200].description })
  @ApiResponse({ status: 400, description: operation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: operation.problemResponses[401].description })
  @ApiResponse({ status: 403, description: operation.problemResponses[403].description })
  @ApiResponse({ status: 404, description: operation.problemResponses[404].description })
  @ApiResponse({ status: 409, description: operation.problemResponses[409].description })
  @ApiResponse({ status: 503, description: operation.problemResponses[503].description })
  @ResponseSchema(operation.successResponses[200].schema)
  async find(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("businessId", new StandardSchemaPipe(operation.pathSchema.shape.businessId)) businessId: string,
    @Body(new StandardSchemaPipe(operation.bodySchema)) body: FindMyBidObservationsCommand,
  ): Promise<MyBidObservationsV1Response> {
    let input: FindMyBidObservationsInput;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      input = {
        workspaceId: principal.workspace.workspaceId,
        registeredBusinessId: BigInt(businessId),
        organizationId: organizationId(BigInt(body.organizationId)),
        buildId: BigInt(body.buildId),
        attempts: body.attempts.map((attempt) => ({
          attemptId: BigInt(attempt.attemptId),
          revisionId: BigInt(attempt.revisionId),
        })),
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return await this.effectRunner.run(this.findMyBidObservations.execute(input));
    } catch (error) {
      return translate(error);
    }
  }
}

/** use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. */
function translate(error: unknown): never {
  if (error instanceof OwnBidAttemptsNotInBuild) throw new BadRequestException({ code: "VALIDATION_ERROR" });
  // 남의 워크스페이스 등록이라는 사실을 본문에 적지 않는다. 어느 쪽인지는 세션 조회가 말한다(ADR 0032 §6).
  if (error instanceof RegisteredBusinessForbidden) throw new ForbiddenException();
  if (error instanceof RegisteredBusinessNotFound) throw new NotFoundException({ code: "NOT_FOUND" });
  // build 전환은 요청을 고쳐서 되는 일이 아니라 목록 전체를 버리고 다시 조회해야 하는 일이다.
  if (error instanceof OwnBidBuildChanged) throw new ConflictException({ code: "CONFLICT" });
  if (error instanceof ProcurementDependencyUnavailable) {
    throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  throw error;
}
