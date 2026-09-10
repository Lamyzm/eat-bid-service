import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import {
  auctionV1Operations,
  codeSchemeV1Operations,
  healthOperations,
  meV1Operations,
  winRateDistributionV1Operations,
  type PublicHttpOperation,
} from "@eatbid/contracts";
import { createApp, type CreateAppOptions } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import {
  anonymousSessionAuthenticator,
  signedInSessionAuthenticator,
} from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const AUCTION_ID = "9007199254740993";
const COOKIE_VALUE = "session-cookie-secret-value";
const BEARER_VALUE = "bearer-secret-value";

type LogRecord = Record<string, unknown>;

/** Nest가 등록하는 route template이다. 로그에는 실제 식별자가 아니라 이 template이 남아야 한다. */
function nestRouteTemplate(operation: PublicHttpOperation): string {
  const version = operation.versioning.kind === "uri"
    ? [operation.versioning.prefix, `v${operation.versioning.version}`]
    : [];
  return `/${[...version, operation.controllerPath, ...(operation.handlerPath ? [operation.handlerPath] : [])].join("/")}`;
}

/**
 * 기존 e2e는 로그를 버리므로 여기서는 writer가 실제로 받은 줄을 모은다. 비밀이 없다는 단언은 parse한 record가
 * 아니라 직렬화된 줄 그대로에 대고 해야 한다.
 */
async function withServer(
  options: Pick<CreateAppOptions, "sessionAuthenticator">,
  run: (server: Server, log: { lines: () => string; records: (event: string) => LogRecord[] }) => Promise<void>,
): Promise<void> {
  const lines: string[] = [];
  const runtime = await createApp({
    environment,
    logWriter: (line) => { lines.push(line); },
    databaseReadiness: { isReady: () => true },
    ...options,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server, {
      lines: () => lines.join(""),
      records: (event) => lines
        .map((line) => JSON.parse(line) as LogRecord)
        .filter((record) => record.event === event),
    });
  } finally {
    await runtime.shutdown();
  }
}

function expectPrivateResponse(response: { headers: Record<string, string> }): void {
  // guard가 끊은 응답도 사용자별 경로의 응답이다. 공유 캐시에 남으면 다음 사용자가 같은 401·403을 받는다.
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect((response.headers["vary"] ?? "").toLowerCase()).toContain("cookie");
}

describe("로그인 게이트 거부의 관측", () => {
  test("미로그인 401은 method·route template·status·요청 id를 한 줄로 남기고 쿠키·토큰 값은 남기지 않는다", async () => {
    await withServer({ sessionAuthenticator: anonymousSessionAuthenticator }, async (server, log) => {
      const response = await request(server)
        .get(auctionV1Operations.find.buildPath({ path: { auctionId: AUCTION_ID } }))
        .set("cookie", `better-auth.session_token=${COOKIE_VALUE}`)
        .set("authorization", `Bearer ${BEARER_VALUE}`)
        .set("x-request-id", "gate.req-401");
      expect(response.status).toBe(401);
      expectPrivateResponse(response);

      const rejected = log.records("request_rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        level: "info",
        service: "eatbid-server",
        requestId: "gate.req-401",
        method: "GET",
        route: nestRouteTemplate(auctionV1Operations.find),
        status: 401,
        errorCode: "UNAUTHENTICATED",
      });
      // guard가 끊었으므로 완료 interceptor는 돌지 않았고, 요약이 완료 로그와 겹치지도 않는다.
      expect(log.records("request_completed")).toHaveLength(0);
      const serialized = log.lines();
      expect(serialized).not.toContain(COOKIE_VALUE);
      expect(serialized).not.toContain(BEARER_VALUE);
      expect(serialized.toLowerCase()).not.toContain("session_token");
      expect(serialized).not.toContain(AUCTION_ID);
    });
  });

  test("Origin 없는 상태 변경 403과 인증을 켜지 않은 배포의 503도 같은 요약을 남기고 캐시 금지 헤더를 갖는다", async () => {
    await withServer({ sessionAuthenticator: signedInSessionAuthenticator }, async (server, log) => {
      const forbidden = await request(server)
        .post(meV1Operations.initializeCurrentAccount.buildPath({ path: undefined }))
        .set("cookie", `better-auth.session_token=${COOKIE_VALUE}`)
        .set("x-request-id", "gate.req-403");
      expect(forbidden.status).toBe(403);
      expectPrivateResponse(forbidden);
      expect(log.records("request_rejected")).toEqual([expect.objectContaining({
        requestId: "gate.req-403",
        method: "POST",
        route: nestRouteTemplate(meV1Operations.initializeCurrentAccount),
        status: 403,
        errorCode: "FORBIDDEN",
      })]);
      expect(log.lines()).not.toContain(COOKIE_VALUE);
    });

    await withServer({}, async (server, log) => {
      const unavailable = await request(server)
        .get(codeSchemeV1Operations.listCodes.buildPath({ path: { scheme: "eat:auction-location-sido" }, query: {} }))
        .set("x-request-id", "gate.req-503");
      expect(unavailable.status).toBe(503);
      expectPrivateResponse(unavailable);
      const rejected = log.records("request_rejected");
      expect(rejected).toHaveLength(1);
      // 503은 원인 분류를 싣는다. 인증 미설정과 DB 장애가 같은 status로 나오므로 로그에서는 갈려야 한다.
      expect(rejected[0]).toMatchObject({
        requestId: "gate.req-503",
        method: "GET",
        route: nestRouteTemplate(codeSchemeV1Operations.listCodes),
        status: 503,
        errorCode: "DEPENDENCY_UNAVAILABLE",
        causeClassification: "error",
      });
    });
  });

  test("완료 interceptor에 닿은 요청은 완료 로그 하나만 남고 거부 요약이 겹치지 않는다", async () => {
    await withServer({ sessionAuthenticator: signedInSessionAuthenticator }, async (server, log) => {
      const live = await request(server).get(healthOperations.live.buildPath({ path: undefined }));
      expect(live.status).toBe(200);

      // query 위반은 pipe가 거부하며 pipe는 interceptor 안에서 돈다. 이 400에는 완료 로그만 있어야 한다.
      const [base] = winRateDistributionV1Operations.find
        .buildPath({ path: {}, query: { scope: "national", floorRate: "90.000", awardMethod: "31" } })
        .split("?");
      const invalid = await request(server).get(`${base}?scope=national&awardMethod=31&floorRate=raw-query-value`);
      expect(invalid.status).toBe(400);

      const completed = log.records("request_completed");
      expect(completed).toHaveLength(2);
      expect(completed[0]).toMatchObject({ route: nestRouteTemplate(healthOperations.live), status: 200 });
      expect(completed[1]).toMatchObject({
        route: nestRouteTemplate(winRateDistributionV1Operations.find),
        status: 400,
        errorCode: "VALIDATION_ERROR",
      });
      expect(log.records("request_rejected")).toHaveLength(0);
      expect(log.lines()).not.toContain("raw-query-value");
    });
  });
});
