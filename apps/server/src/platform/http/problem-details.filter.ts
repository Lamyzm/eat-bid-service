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

export function problemForStatus(status: number, requestId: string): ProblemDetails {
  const normalizedStatus = definitions[status] ? status : HttpStatus.INTERNAL_SERVER_ERROR;
  const definition = definitions[normalizedStatus]!;
  return {
    type: `https://eatbid.dev/problems/${definition.slug}`,
    title: definition.title,
    status: normalizedStatus,
    code: definition.code,
    requestId,
  };
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
    const problem = problemForStatus(requestedStatus, requestIdOf(request));
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
