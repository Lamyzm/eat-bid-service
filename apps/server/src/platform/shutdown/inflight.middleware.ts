import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InflightTracker } from "./inflight-tracker";

export function createInflightMiddleware(tracker: InflightTracker): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const release = tracker.acquire();
    response.once("finish", release);
    response.once("close", release);
    request.once("aborted", release);
    next();
  };
}
