/** @module 책임: Nest application의 보안·관측·계약·종료 정책을 한 bootstrap 경계에서 조립한다. */
import {
  type INestApplication,
  RequestMethod,
  type Type,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { healthOperations, publicHttpOperationRegistry } from "@eatbid/contracts";
import { systemClock, type Clock } from "@eatbid/domain";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Server } from "node:http";
import { AppModule } from "../app.module";
import { type Environment, readEnvironment } from "../platform/config/environment";
import type { DatabaseReadiness } from "../platform/health/health.module";
import type { AccountRepository } from "../modules/account/application/account-repository";
import { createAuthInstance, type AuthInstance } from "../platform/auth/auth-instance";
import { createAuthTransportMount } from "../platform/auth/auth-transport";
import { createBetterAuthSessionAuthenticator } from "../platform/auth/better-auth-session-authenticator";
import { OriginGuard } from "../platform/auth/origin.guard";
import { mountPrivateResponseHeaders } from "../platform/auth/private-response.middleware";
import type { SessionAuthenticator } from "../platform/auth/session-authenticator";
import { createAuthDatabaseBinding } from "../platform/database/auth-database-adapter";
import { createManagedDatabase, type ManagedDatabase } from "../platform/database/managed-database";
import type { AuctionReader } from "../modules/procurement/application/auction-reader";
import type { AuctionRosterReader } from "../modules/procurement/application/auction-roster-reader";
import type { OpenAuctionReader } from "../modules/procurement/application/open-auction-reader";
import type { OrganizationAttemptReader } from "../modules/procurement/application/organization-attempt-reader";
import type { WinRateDistributionReader } from "../modules/procurement/application/win-rate-distribution-reader";
import type { CodeReader } from "../modules/reference/application/code-reader";
import { ReadinessState } from "../platform/health/readiness-state";
import {
  problemForStatus,
  ProblemDetailsFilter,
  supportedBodyParserStatus,
} from "../platform/http/problem-details.filter";
import { RequestCompletionInterceptor } from "../platform/http/request-completion.interceptor";
import { ResponseSchemaInterceptor } from "../platform/http/response-schema.interceptor";
import { LoggingModule, RedactingJsonLogger } from "../platform/logging/logging.module";
import {
  createRequestContextMiddleware,
  requestIdOf,
} from "../platform/request-context/request-context.middleware";
import { RequestContextStore } from "../platform/request-context/request-context.module";
import { createInflightMiddleware } from "../platform/shutdown/inflight.middleware";
import { InflightTracker } from "../platform/shutdown/inflight-tracker";
import { ShutdownCoordinator, type ShutdownResult } from "../platform/shutdown/shutdown-coordinator";
import { createOpenApiDocument } from "./openapi";

export interface CreateAppOptions {
  readonly environment?: Environment;
  readonly clock?: Clock;
  readonly logWriter?: (line: string) => void;
  readonly databaseReadiness?: DatabaseReadiness;
  readonly auctionReader?: AuctionReader;
  readonly auctionRosterReader?: AuctionRosterReader;
  readonly openAuctionReader?: OpenAuctionReader;
  readonly organizationAttemptReader?: OrganizationAttemptReader;
  readonly winRateDistributionReader?: WinRateDistributionReader;
  readonly codeReader?: CodeReader;
  readonly accountRepository?: AccountRepository;
  /**
   * 실제 provider 대신 주체만 주입하는 자리다. 테스트가 Google 네트워크를 부르지 않게 하되, production
   * 코드에는 환경변수나 헤더로 인증을 건너뛰는 분기를 두지 않는다(ADR 0032 §9).
   */
  readonly sessionAuthenticator?: SessionAuthenticator;
  readonly mountPreParserRawTransport?: (application: Express) => void;
  readonly testOnlyImports?: readonly Type[];
}

export interface OperationalHttpApplication {
  readonly app: INestApplication;
  readonly environment: Environment;
  readonly expressApplication: Express;
  readonly logger: RedactingJsonLogger;
  readonly requestContext: RequestContextStore;
  readonly tracker: InflightTracker;
  readonly readiness: ReadinessState;
  readonly openApiDocument: ReturnType<typeof createOpenApiDocument>;
  listen(port?: number, host?: string): Promise<Server>;
  shutdown(): Promise<ShutdownResult>;
}

/**
 * Express가 전송 계층과 미들웨어 순서를 소유하고 Nest는 라우팅 계층만 소유한다.
 * 이 경계를 한 곳에서 조립해야 요청 추적과 종료 lease가 파서 오류에도 빠지지 않는다.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<OperationalHttpApplication> {
  const environment = options.environment ?? readEnvironment();
  const clock = options.clock ?? systemClock;
  if (options.testOnlyImports && environment.runtimeMode !== "test") {
    throw new Error("testOnlyImports can only be used in the test runtime");
  }
  const logger = LoggingModule.create(environment, clock, options.logWriter);
  const requestContext = new RequestContextStore();
  const tracker = new InflightTracker();
  const readiness = new ReadinessState();
  const expressApplication = express();
  const adapter = new ExpressAdapter(expressApplication);
  // 연결 handle을 여기서 먼저 만드는 이유는 인증 adapter가 Nest DI보다 앞선 slot에서 필요하기 때문이다.
  // 이 시점에는 실제 dial이 일어나지 않지만 소유권은 아직 Nest 종료 단계에 없다. 조립이 실패하면
  // 재시작 루프가 연결을 계속 쌓으므로, Nest가 소유권을 받기 전 실패만 여기서 닫는다.
  const connection: ManagedDatabase = createManagedDatabase(environment.databaseUrl);

  // Nest가 자원으로 받기 전까지 풀 종료 책임은 이 조립에 있다. 여기서 실패하면 종료 lifecycle이 아직
  // 이 풀을 모르므로, 같은 프로세스에서 조립을 반복하는 경우 연결이 계속 쌓인다.
  let app: INestApplication;
  try {
    const auth: AuthInstance | null = environment.auth === null
      ? null
      : createAuthInstance({
        environment: environment.auth,
        database: createAuthDatabaseBinding(connection),
        trustedOrigins: environment.corsOrigins,
        logger,
      });
    // 인증을 켜지 않은 배포가 조용히 지나가지 않게 시작 로그에 남긴다. 공개 read는 그대로 동작한다.
    if (auth === null) logger.lifecycle("auth_disabled");
    const sessionAuthenticator: SessionAuthenticator | null = options.sessionAuthenticator
      ?? (auth === null ? null : createBetterAuthSessionAuthenticator(auth));

    expressApplication.disable("x-powered-by");
    expressApplication.set("trust proxy", environment.proxyHops);
    expressApplication.use(createRequestContextMiddleware(requestContext));
    expressApplication.use(createInflightMiddleware(tracker));
    expressApplication.use(helmet());
    adapter.enableCors({
      credentials: true,
      origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
        callback(null, origin === undefined || environment.corsOrigins.includes(origin));
      },
    });

    // 개인 응답 경로는 guard보다 먼저 캐시 금지를 붙인다. guard가 끊는 401·403에도 헤더가 남아야 한다.
    // 목록은 registry별로 적지 않고 versioned canonical operation 전부에서 파생한다. 공개 화면이 없으므로
    // (ADR 0032 §12) `/api/v1/**`에는 사용자 구분 없이 공유 캐시에 둬도 되는 응답이 없고, registry를 골라
    // 적던 목록은 공유 read가 게이트 뒤로 옮겨질 때 따라가지 않았다. version-neutral인 health probe와
    // provider가 자기 헤더를 붙이는 raw auth 전송만 밖에 남는다.
    mountPrivateResponseHeaders(
      expressApplication,
      publicHttpOperationRegistry.filter((operation) => operation.versioning.kind === "uri"),
    );

    // 원문 바이트 서명 검증은 보안 헤더/CORS 뒤이면서 파서 앞이어야 하므로 이 슬롯을 고정한다.
    (options.mountPreParserRawTransport ?? createAuthTransportMount(auth))(expressApplication);

    expressApplication.use(express.json({ limit: environment.payloadLimit, strict: true }));
    expressApplication.use(express.urlencoded({
      extended: false,
      limit: environment.payloadLimit,
      parameterLimit: 100,
    }));
    expressApplication.use((
      error: unknown,
      request: Request,
      response: Response,
      next: NextFunction,
    ): void => {
      // 공격자가 임의 status를 붙인 오류를 4xx로 위장하지 못하도록 파서가 만드는 좁은 형태만 신뢰한다.
      const status = supportedBodyParserStatus(error);
      if (status === undefined) return next(error);
      response.status(status).type("application/problem+json").send(
        problemForStatus(status, response.getHeader("x-request-id")?.toString() ?? "unavailable"),
      );
    });

    app = await NestFactory.create(
      AppModule.forRuntime({
        environment,
        clock,
        logger,
        requestContext,
        readiness,
        databaseReadiness: options.databaseReadiness,
        auctionReader: options.auctionReader,
        auctionRosterReader: options.auctionRosterReader,
        openAuctionReader: options.openAuctionReader,
        organizationAttemptReader: options.organizationAttemptReader,
        winRateDistributionReader: options.winRateDistributionReader,
        codeReader: options.codeReader,
        accountRepository: options.accountRepository,
        connection,
        sessionAuthenticator,
        testOnlyImports: options.testOnlyImports,
      }),
      adapter,
      // 운영에서는 조립 실패를 그대로 죽여 반쯤 산 프로세스가 트래픽을 받지 않게 한다. 검사 실행에서만
      // 오류를 호출자에게 돌려주는 이유는 `process.abort`가 finally를 건너뛰어, 일회용 PostgreSQL
      // container를 소유한 harness가 자기 자원을 정리하지 못한 채 사라지기 때문이다.
      { abortOnError: environment.runtimeMode !== "test", bodyParser: false, logger },
    );
  } catch (error) {
    // 이 지점 이후의 실패는 Nest 종료 단계가 같은 풀을 닫는다.
    await connection.client.end().catch(() => undefined);
    throw error;
  }

  app.setGlobalPrefix("api", {
    exclude: [
      // 운영 probe와 원문 인증 전송은 API 버전 수명주기에 결합하지 않는다.
      { path: healthOperations.live.buildPath({ path: undefined }).slice(1), method: RequestMethod.ALL },
      { path: healthOperations.ready.buildPath({ path: undefined }).slice(1), method: RequestMethod.ALL },
      { path: "api/auth/{*path}", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalInterceptors(
    new RequestCompletionInterceptor(logger),
    new ResponseSchemaInterceptor(),
  );
  // Origin 검사를 전역에 두는 이유: 새 mutation operation 하나가 decorator를 빠뜨려도 검사가 남는다.
  // `/api/auth/*`는 Nest 앞 Express에서 끝나므로 provider 자신의 CSRF 검사가 그 경로를 맡는다.
  app.useGlobalGuards(new OriginGuard(environment.corsOrigins));
  app.useGlobalFilters(new ProblemDetailsFilter(logger));

  const openApiDocument = createOpenApiDocument();
  if (environment.swaggerEnabled) {
    SwaggerModule.setup("docs", app, openApiDocument as never, {
      jsonDocumentUrl: "docs/openapi.json",
    });
  }
  await app.init();
  expressApplication.use((request: Request, response: Response): void => {
    response.status(404).type("application/problem+json").send(problemForStatus(404, requestIdOf(request)));
  });

  const shutdownCoordinator = new ShutdownCoordinator(
    app,
    readiness,
    tracker,
    logger,
    environment.shutdownGrace,
  );
  return {
    app,
    environment,
    expressApplication,
    logger,
    requestContext,
    tracker,
    readiness,
    openApiDocument,
    async listen(port = environment.port, host = "0.0.0.0"): Promise<Server> {
      await app.listen(port, host);
      const server = app.getHttpServer() as Server;
      shutdownCoordinator.attachServer(server);
      return server;
    },
    shutdown: () => shutdownCoordinator.shutdown(),
  };
}

export function isSupportedBodyParserError(error: unknown): boolean {
  return supportedBodyParserStatus(error) !== undefined;
}
