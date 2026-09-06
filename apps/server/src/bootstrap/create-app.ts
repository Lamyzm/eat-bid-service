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
import { healthOperations } from "@eatbid/contracts";
import { systemClock, type Clock } from "@eatbid/domain";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Server } from "node:http";
import { AppModule } from "../app.module";
import { type Environment, readEnvironment } from "../platform/config/environment";
import type { DatabaseReadiness } from "../platform/health/health.module";
import type { AuctionReader } from "../modules/procurement/application/auction-reader";
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
  readonly organizationAttemptReader?: OrganizationAttemptReader;
  readonly winRateDistributionReader?: WinRateDistributionReader;
  readonly codeReader?: CodeReader;
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

  // 원문 바이트 서명 검증은 보안 헤더/CORS 뒤이면서 파서 앞이어야 하므로 이 슬롯을 고정한다.
  options.mountPreParserRawTransport?.(expressApplication);

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

  const app = await NestFactory.create(
    AppModule.forRuntime({
      environment,
      clock,
      logger,
      requestContext,
      readiness,
      databaseReadiness: options.databaseReadiness,
      auctionReader: options.auctionReader,
      organizationAttemptReader: options.organizationAttemptReader,
      winRateDistributionReader: options.winRateDistributionReader,
      codeReader: options.codeReader,
      testOnlyImports: options.testOnlyImports,
    }),
    adapter,
    { abortOnError: true, bodyParser: false, logger },
  );
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
