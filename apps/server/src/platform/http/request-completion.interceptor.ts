import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";
import { RedactingJsonLogger } from "../logging/logging.module";
import { requestIdOf } from "../request-context/request-context.middleware";
import { routeTemplate } from "./problem-details.filter";

@Injectable()
export class RequestCompletionInterceptor implements NestInterceptor {
  constructor(private readonly logger: RedactingJsonLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
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
        durationMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000),
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
