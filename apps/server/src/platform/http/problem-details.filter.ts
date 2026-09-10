/** @module 책임: 모든 예외를 허용된 공개 Problem Details taxonomy로만 닫아 내부 정보 노출을 막는다. */
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
import { completionLogClaimed, routeTemplate } from "./request-completion-log";

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

// 자원별 404는 화면이 "없는 공고"와 "없는 기관"을 구분해야 하므로 allowlist로만 세분한다.
const specificNotFound: Readonly<Record<string, ProblemDefinition>> = {
  AUCTION_NOT_FOUND: { code: "AUCTION_NOT_FOUND", slug: "auction-not-found", title: "Auction not found" },
  ORGANIZATION_NOT_FOUND: {
    code: "ORGANIZATION_NOT_FOUND",
    slug: "organization-not-found",
    title: "Organization not found",
  },
};

function definitionForException(exception: unknown, status: number): ProblemDefinition | undefined {
  if (!(exception instanceof HttpException) || status !== 404) return undefined;
  const response = exception.getResponse();
  if (typeof response !== "object" || response === null) return undefined;
  const code = (response as { code?: unknown }).code;
  // prototype 상속 key가 정의처럼 반환되지 않도록 자기 속성만 allowlist로 인정한다.
  return typeof code === "string" && Object.hasOwn(specificNotFound, code)
    ? specificNotFound[code]
    : undefined;
}

export function problemForStatus(
  status: number,
  requestId: string,
  override?: ProblemDefinition,
): ProblemDetails {
  // 임의 상태와 예외 본문을 반사하지 않고 허용된 공개 문제 taxonomy 밖은 500으로 닫는다.
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
  // 공격자가 만든 일반 Error의 status 필드는 신뢰하지 않고 body-parser 고유 표식 조합만 허용한다.
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
    // guard가 끊은 요청은 완료 interceptor에 닿지 않아 여기가 유일한 기록 지점이다. interceptor가 이미
    // 맡은 응답(pipe·handler가 던진 예외)은 finish 시점에 완료 로그가 남으므로 여기서 다시 남기지 않는다.
    if (!completionLogClaimed(response)) {
      this.logger.rejection({
        requestId: problem.requestId,
        method: request.method,
        route: routeTemplate(request),
        status: problem.status,
        errorCode: problem.code,
        // 503의 원인 분류는 defect 로그가 다루지 않는다(500만 다룬다). 4xx 예외에는 원인이 없어 stack 분류만
        // 남으므로 싣지 않는다.
        ...(problem.status === 503 ? { error: exception } : {}),
      });
    }
    response.status(problem.status).type("application/problem+json").send(problem);
  }
}
