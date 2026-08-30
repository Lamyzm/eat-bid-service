import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { ProblemCode, ProblemDetails } from "@eatbid/contracts";
import type { Request, Response } from "express";
import { RedactingJsonLogger } from "../logging/logging.module";
import { requestIdOf } from "../request-context/request-context.middleware";

type ProblemDefinition = Readonly<{ code: ProblemCode; slug: string; title: string }>;

type SupportedBodyParserError = Error & Readonly<{
  expose: true;
  status: 400 | 413;
  statusCode: 400 | 413;
  type: "entity.parse.failed" | "entity.too.large";
}>;

const definitions: Readonly<Record<number, ProblemDefinition>> = {
  400: { code: "VALIDATION_ERROR", slug: "validation-error", title: "Request validation failed" },
  401: { code: "UNAUTHENTICATED", slug: "unauthenticated", title: "Authentication required" },
  403: { code: "FORBIDDEN", slug: "forbidden", title: "Access forbidden" },
  404: { code: "NOT_FOUND", slug: "not-found", title: "Resource not found" },
  409: { code: "CONFLICT", slug: "conflict", title: "Resource conflict" },
  413: { code: "VALIDATION_ERROR", slug: "payload-too-large", title: "Request payload is too large" },
  429: { code: "RATE_LIMITED", slug: "rate-limited", title: "Rate limit exceeded" },
  503: { code: "DEPENDENCY_UNAVAILABLE", slug: "dependency-unavailable", title: "Dependency unavailable" },
  500: { code: "INTERNAL_ERROR", slug: "internal-error", title: "Internal server error" },
};

const auctionNotFound: ProblemDefinition = {
  code: "AUCTION_NOT_FOUND",
  slug: "auction-not-found",
  title: "Auction not found",
};

function definitionForException(exception: unknown, status: number): ProblemDefinition | undefined {
  if (!(exception instanceof HttpException) || status !== 404) return undefined;
  const response = exception.getResponse();
  return typeof response === "object" && response !== null
    && (response as { code?: unknown }).code === "AUCTION_NOT_FOUND"
    ? auctionNotFound
    : undefined;
}

export function problemForStatus(
  status: number,
  requestId: string,
  override?: ProblemDefinition,
): ProblemDetails {
  const normalizedStatus = definitions[status] ? status : HttpStatus.INTERNAL_SERVER_ERROR;
  const definition = override ?? definitions[normalizedStatus]!;
  return {
    type: `https://eatbid.dev/problems/${definition.slug}`,
    title: definition.title,
    status: normalizedStatus,
    code: definition.code,
    requestId,
  };
}

export function supportedBodyParserStatus(error: unknown): 400 | 413 | undefined {
  if (!(error instanceof Error)) return undefined;
  const candidate = error as Partial<SupportedBodyParserError>;
  if (candidate.expose !== true || candidate.status !== candidate.statusCode) return undefined;
  if (candidate.status === 400 && candidate.type === "entity.parse.failed" && error instanceof SyntaxError) {
    return 400;
  }
  if (candidate.status === 413 && candidate.type === "entity.too.large") return 413;
  return undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: RedactingJsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestedStatus = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const problem = problemForStatus(
      requestedStatus,
      requestIdOf(request),
      definitionForException(exception, requestedStatus),
    );
    response.locals.problemCode = problem.code;
    if (!(exception instanceof HttpException) || problem.status === 500) {
      this.logger.defect({
        requestId: problem.requestId,
        route: routeTemplate(request),
        error: exception,
      });
    }
    response.status(problem.status).type("application/problem+json").send(problem);
  }
}

export function routeTemplate(request: Request): string {
  const path = request.route?.path;
  return typeof path === "string" ? `${request.baseUrl ?? ""}${path}` || "/" : "unmatched";
}
