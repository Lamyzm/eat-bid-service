import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { RequestContextStore } from "./request-context.module";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const requestIdKey = Symbol("eatbidRequestId");

type ContextRequest = Request & { [requestIdKey]?: string };

export function selectRequestId(candidate: unknown): string {
  return typeof candidate === "string" && requestIdPattern.test(candidate) ? candidate : randomUUID();
}

export function requestIdOf(request: Request): string {
  return (request as ContextRequest)[requestIdKey] ?? "unavailable";
}

export function createRequestContextMiddleware(store: RequestContextStore): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    // context에는 상관관계 ID만 넣고 인증 정보나 트랜잭션을 숨겨 전달하는 service locator로 쓰지 않는다.
    const requestId = selectRequestId(request.header("x-request-id"));
    (request as ContextRequest)[requestIdKey] = requestId;
    response.setHeader("x-request-id", requestId);
    store.run({ requestId }, next);
  };
}
