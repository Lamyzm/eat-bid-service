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
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Server } from "node:http";
import { AppModule } from "../app.module";
import { type Environment, readEnvironment } from "../platform/config/environment";
import type { DatabaseReadiness } from "../platform/health/health.module";
import type { AuctionReader } from "../modules/procurement/application/auction-reader";
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
  readonly logWriter?: (line: string) => void;
  readonly databaseReadiness?: DatabaseReadiness;
  readonly auctionReader?: AuctionReader;
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

export async function createApp(options: CreateAppOptions = {}): Promise<OperationalHttpApplication> {
  const environment = options.environment ?? readEnvironment();
  if (options.testOnlyImports && environment.runtimeMode !== "test") {
    throw new Error("testOnlyImports can only be used in the test runtime");
  }
  const logger = LoggingModule.create(environment, options.logWriter);
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

  // Gate 16.4 mounts the byte-preserving raw auth transport in this ordered slot.
  options.mountPreParserRawTransport?.(expressApplication);

  expressApplication.use(express.json({ limit: environment.payloadLimitBytes, strict: true }));
  expressApplication.use(express.urlencoded({
    extended: false,
    limit: environment.payloadLimitBytes,
    parameterLimit: 100,
  }));
  expressApplication.use((
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    const status = supportedBodyParserStatus(error);
    if (status === undefined) return next(error);
    response.status(status).type("application/problem+json").send(
      problemForStatus(status, response.getHeader("x-request-id")?.toString() ?? "unavailable"),
    );
  });

  const app = await NestFactory.create(
    AppModule.forRuntime({
      environment,
      logger,
      requestContext,
      readiness,
      databaseReadiness: options.databaseReadiness,
      auctionReader: options.auctionReader,
      testOnlyImports: options.testOnlyImports,
    }),
    adapter,
    { abortOnError: true, bodyParser: false, logger },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      { path: healthOperations.live.path.slice(1), method: RequestMethod.ALL },
      { path: healthOperations.ready.path.slice(1), method: RequestMethod.ALL },
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
    environment.shutdownGraceMs,
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
