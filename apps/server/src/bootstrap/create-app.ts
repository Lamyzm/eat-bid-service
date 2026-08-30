import {
  type INestApplication,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Server } from "node:http";
import { AppModule } from "../app.module";
import { type Environment, readEnvironment } from "../platform/config/environment";
import type { DatabaseReadiness } from "../platform/health/health.module";
import { ReadinessState } from "../platform/health/readiness-state";
import { problemForStatus, ProblemDetailsFilter } from "../platform/http/problem-details.filter";
import { RequestCompletionInterceptor } from "../platform/http/request-completion.interceptor";
import { ResponseSchemaInterceptor } from "../platform/http/response-schema.interceptor";
import { LoggingModule, RedactingJsonLogger } from "../platform/logging/logging.module";
import { createRequestContextMiddleware } from "../platform/request-context/request-context.middleware";
import { RequestContextStore } from "../platform/request-context/request-context.module";
import { createInflightMiddleware } from "../platform/shutdown/inflight.middleware";
import { InflightTracker } from "../platform/shutdown/inflight-tracker";
import { ShutdownCoordinator, type ShutdownResult } from "../platform/shutdown/shutdown-coordinator";
import { createOpenApiDocument } from "./openapi";

export interface CreateAppOptions {
  readonly environment?: Environment;
  readonly logWriter?: (line: string) => void;
  readonly databaseReadiness?: DatabaseReadiness;
  readonly mountPreParserRawTransport?: (application: Express) => void;
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
  const logger = LoggingModule.create(environment, options.logWriter);
  const requestContext = new RequestContextStore();
  const tracker = new InflightTracker();
  const readiness = new ReadinessState();
  const expressApplication = express();

  expressApplication.disable("x-powered-by");
  expressApplication.set("trust proxy", environment.proxyHops);
  expressApplication.use(createRequestContextMiddleware(requestContext));
  expressApplication.use(createInflightMiddleware(tracker));
  expressApplication.use(helmet());

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
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
    if (status !== 413) return next(error);
    response.status(413).type("application/problem+json").send(
      problemForStatus(413, response.getHeader("x-request-id")?.toString() ?? "unavailable"),
    );
  });

  const adapter = new ExpressAdapter(expressApplication);
  const app = await NestFactory.create(
    AppModule.forRuntime({
      environment,
      logger,
      requestContext,
      readiness,
      databaseReadiness: options.databaseReadiness,
    }),
    adapter,
    { abortOnError: true, bodyParser: false, logger },
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableCors({
    credentials: true,
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (origin === undefined || environment.corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"), false);
    },
  });
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
