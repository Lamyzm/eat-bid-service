/** @module 책임: 내 계정 초기화와 등록 사업자·위치 command의 HTTP 계약을 use case와 공개 응답으로 잇는다. */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  meV1Operations,
  type AccountInitializationV1Response,
  type MyBusinessesV1Response,
  type MyBusinessV1Response,
  type RegisterMyBusinessCommandInput,
  type SetMyBusinessLocationCommandInput,
} from "@eatbid/contracts";
import type { AuthenticatedSubject } from "../../../../platform/auth/auth-identity";
import { CurrentPrincipal, ProviderSubject } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { PrincipalGuard, ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import {
  AccountDependencyUnavailable,
  RegisteredBusinessConflict,
  RegisteredBusinessForbidden,
  RegisteredBusinessNotFound,
  WorkspaceRoleForbidden,
} from "../../application/account-repository";
import { InitializeCurrentAccount } from "../../application/initialize-current-account";
import {
  ChangeMyBusinessLocation,
  ListMyBusinesses,
  RegisterMyBusiness,
} from "../../application/manage-my-businesses";

const initialize = meV1Operations.initializeCurrentAccount;
const list = meV1Operations.listMyBusinesses;
const register = meV1Operations.registerMyBusiness;
const setLocation = meV1Operations.setMyBusinessLocation;
const clearLocation = meV1Operations.clearMyBusinessLocation;

/** use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. */
function translate(error: unknown): never {
  if (error instanceof AccountDependencyUnavailable) {
    throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  if (error instanceof RegisteredBusinessConflict) throw new ConflictException({ code: "CONFLICT" });
  // 403 본문에 어떤 워크스페이스·사업자인지, 역할 부족인지 적지 않는다. ProblemDetails는 strict object라
  // 애초에 추가 필드가 불가능하고, 세 원인을 응답에서 갈라 주면 남의 자원의 존재가 새어 나간다.
  if (error instanceof RegisteredBusinessForbidden || error instanceof WorkspaceRoleForbidden) {
    throw new ForbiddenException();
  }
  if (error instanceof RegisteredBusinessNotFound) throw new NotFoundException({ code: "NOT_FOUND" });
  throw error;
}

@Controller({
  path: initialize.controllerPath,
  version: initialize.version ?? VERSION_NEUTRAL,
})
export class MeController {
  constructor(
    private readonly initializeCurrentAccount: InitializeCurrentAccount,
    private readonly listMyBusinesses: ListMyBusinesses,
    private readonly registerMyBusiness: RegisterMyBusiness,
    private readonly changeMyBusinessLocation: ChangeMyBusinessLocation,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 초기화만 principal이 아직 없어도 되는 요청이다. 다른 handler는 app 관계를 이미 요구한다.
  @Post(initialize.handlerPath)
  @HttpCode(200)
  @UseGuards(ProviderSessionGuard)
  @ApiOperation({ operationId: initialize.operationId, summary: initialize.summary })
  @ApiResponse({ status: 200, description: initialize.successResponses[200].description })
  @ApiResponse({ status: 401, description: initialize.problemResponses[401].description })
  @ApiResponse({ status: 403, description: initialize.problemResponses[403].description })
  @ResponseSchema(initialize.successResponses[200].schema)
  async initialize(
    @ProviderSubject() subject: AuthenticatedSubject,
  ): Promise<AccountInitializationV1Response> {
    try {
      return await this.effectRunner.run(this.initializeCurrentAccount.execute(subject.subject));
    } catch (error) {
      return translate(error);
    }
  }

  @Get(list.handlerPath)
  @UseGuards(PrincipalGuard)
  @ApiOperation({ operationId: list.operationId, summary: list.summary })
  @ApiResponse({ status: 200, description: list.successResponses[200].description })
  @ApiResponse({ status: 401, description: list.problemResponses[401].description })
  @ApiResponse({ status: 403, description: list.problemResponses[403].description })
  @ResponseSchema(list.successResponses[200].schema)
  async list(@CurrentPrincipal() principal: ResolvedPrincipal): Promise<MyBusinessesV1Response> {
    try {
      return await this.effectRunner.run(this.listMyBusinesses.execute(principal));
    } catch (error) {
      return translate(error);
    }
  }

  @Post(register.handlerPath)
  @HttpCode(201)
  @UseGuards(PrincipalGuard)
  @ApiOperation({ operationId: register.operationId, summary: register.summary })
  @ApiResponse({ status: 201, description: register.successResponses[201].description })
  @ApiResponse({ status: 403, description: register.problemResponses[403].description })
  @ApiResponse({ status: 409, description: register.problemResponses[409].description })
  @ResponseSchema(register.successResponses[201].schema)
  async register(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    // 정규화 이전 입력이 아니라 pipe가 검증·정규화한 출력 타입을 받는다. 두 타입이 다른 이유는 사업자번호
    // command가 사용자 표기를 canonical 숫자로 바꾸기 때문이며, 수기 shape를 쓰면 그 차이가 지워진다.
    @Body(new StandardSchemaPipe(register.bodySchema)) body: RegisterMyBusinessCommandInput,
  ): Promise<MyBusinessV1Response> {
    try {
      return await this.effectRunner.run(
        this.registerMyBusiness.execute({ principal, businessNumber: body.businessNumber }),
      );
    } catch (error) {
      return translate(error);
    }
  }

  @Put(setLocation.handlerPath)
  @UseGuards(PrincipalGuard)
  @ApiOperation({ operationId: setLocation.operationId, summary: setLocation.summary })
  @ApiResponse({ status: 200, description: setLocation.successResponses[200].description })
  @ApiResponse({ status: 403, description: setLocation.problemResponses[403].description })
  @ApiResponse({ status: 404, description: setLocation.problemResponses[404].description })
  @ResponseSchema(setLocation.successResponses[200].schema)
  async setLocation(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("businessId", new StandardSchemaPipe(setLocation.pathSchema.shape.businessId)) businessId: string,
    @Body(new StandardSchemaPipe(setLocation.bodySchema)) body: SetMyBusinessLocationCommandInput,
  ): Promise<MyBusinessV1Response> {
    return this.changeLocation(principal, businessId, body.addressText);
  }

  @Delete(clearLocation.handlerPath)
  @UseGuards(PrincipalGuard)
  @ApiOperation({ operationId: clearLocation.operationId, summary: clearLocation.summary })
  @ApiResponse({ status: 200, description: clearLocation.successResponses[200].description })
  @ApiResponse({ status: 403, description: clearLocation.problemResponses[403].description })
  @ApiResponse({ status: 404, description: clearLocation.problemResponses[404].description })
  @ResponseSchema(clearLocation.successResponses[200].schema)
  async clearLocation(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("businessId", new StandardSchemaPipe(clearLocation.pathSchema.shape.businessId)) businessId: string,
  ): Promise<MyBusinessV1Response> {
    return this.changeLocation(principal, businessId, null);
  }

  private async changeLocation(
    principal: ResolvedPrincipal,
    businessId: string,
    addressText: string | null,
  ): Promise<MyBusinessV1Response> {
    try {
      return await this.effectRunner.run(this.changeMyBusinessLocation.execute({
        principal,
        // path parameter는 계약이 검증한 canonical decimal text이므로 Number를 거치지 않고 bigint로 연다.
        registeredBusinessId: BigInt(businessId),
        addressText,
      }));
    } catch (error) {
      return translate(error);
    }
  }
}
