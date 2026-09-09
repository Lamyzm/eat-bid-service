/**
 * @module 책임: 사용자별 응답이 지나는 경로에 캐시 금지 헤더를 guard보다 먼저 붙인다.
 *
 * 왜 middleware인가: 성공 응답뿐 아니라 guard가 만드는 401·403과 의존성 장애 503에도 같은 헤더가 있어야
 * 한다. controller나 interceptor에 두면 guard에서 끊긴 응답에는 헤더가 없고, 그 응답은 사용자 구분 없이
 * 공유 캐시에 남을 수 있다. provider가 자기 응답에 붙이는 헤더는 이 경로로 이어지지 않는다.
 */
import type { PublicHttpOperation } from "@eatbid/contracts";
import type { Express, NextFunction, Request, Response } from "express";

const PRIVATE_CACHE_CONTROL = "private, no-store";

/**
 * 경로 문자열을 손으로 적지 않고 operation의 semantic route에서 resource 경계를 만든다. 새 개인
 * operation이 같은 resource에 붙으면 자동으로 포함되고, 다른 resource면 registry에 넣는 순간 드러난다.
 */
export function privateResourcePrefixes(
  operations: readonly PublicHttpOperation[],
): readonly string[] {
  const prefixes = new Set<string>();
  for (const operation of operations) {
    const version = operation.versioning.kind === "uri"
      ? [operation.versioning.prefix, `v${operation.versioning.version}`]
      : [];
    prefixes.add(`/${[...version, operation.route.resource].join("/")}`);
  }
  return [...prefixes].sort();
}

export function mountPrivateResponseHeaders(
  application: Express,
  operations: readonly PublicHttpOperation[],
): void {
  for (const prefix of privateResourcePrefixes(operations)) {
    application.use(prefix, (_request: Request, response: Response, next: NextFunction): void => {
      response.setHeader("cache-control", PRIVATE_CACHE_CONTROL);
      // `Vary`는 덮어쓰지 않고 더한다. CORS가 이미 붙인 `Vary: Origin`을 지우면 origin마다 달라지는
      // 응답이 공유 캐시에서 섞인다.
      response.vary("Cookie");
      next();
    });
  }
}
