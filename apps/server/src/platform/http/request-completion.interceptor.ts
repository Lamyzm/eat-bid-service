/**
 * @module 책임: Nest route에 도달한 요청의 완료 로그(route template·status·소요 시간)를 응답당 한 번 남긴다.
 *
 * guard가 끊은 요청은 이 interceptor에 닿지 않는다. 그 요약은 exception filter가 남기며, 두 경계가 같은 응답을
 * 두 번 기록하지 않도록 여기서 먼저 소유권을 선언한다.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";
import { RedactingJsonLogger } from "../logging/logging.module";
import { requestIdOf } from "../request-context/request-context.middleware";
import { claimCompletionLog, routeTemplate } from "./request-completion-log";
import { milliseconds } from "@eatbid/domain";

@Injectable()
export class RequestCompletionInterceptor implements NestInterceptor {
  constructor(private readonly logger: RedactingJsonLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    // pipe·handler·filter가 이 뒤에서 무엇을 던지든 완료 로그는 이 interceptor가 남긴다고 먼저 선언한다.
    claimCompletionLog(response);
    const started = performance.now();
    let completed = false;
    // finish와 close가 함께 발생해도 Nest route 완료 로그는 한 번만 기록한다.
    const complete = (): void => {
      if (completed) return;
      completed = true;
      this.logger.completion({
        requestId: requestIdOf(request),
        method: request.method,
        route: routeTemplate(request),
        status: response.statusCode,
        duration: milliseconds(Math.max(0, Math.round(performance.now() - started))),
        ...(typeof response.locals.problemCode === "string"
          ? { errorCode: response.locals.problemCode }
          : {}),
      });
    };
    response.once("finish", complete);
    response.once("close", complete);
    return next.handle();
  }
}
