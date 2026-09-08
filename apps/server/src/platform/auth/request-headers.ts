/**
 * @module 책임: Node 요청 헤더를 인증 port가 받는 web `Headers`로 바꾸는 변환 하나만 소유한다.
 *
 * 이 변환을 guard와 controller가 각자 하면 provider library import가 presentation까지 번진다.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

export function webHeadersOf(request: Request): Headers {
  return fromNodeHeaders(request.headers);
}
