import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InflightTracker } from "./inflight-tracker";

export function createInflightMiddleware(tracker: InflightTracker): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const release = tracker.acquire();
    // 정상 응답, 소켓 조기 종료, 요청 abort 모두 같은 idempotent lease를 해제한다.
    response.once("finish", release);
    response.once("close", release);
    request.once("aborted", release);
    next();
  };
}
