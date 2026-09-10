import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import {
  auctionV1Operations,
  codeSchemeV1Operations,
  organizationV1Operations,
  winRateDistributionV1Operations,
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

/** 게이트가 붙은 공유 read 전부다. 새 공유 read가 이 목록에 없으면 그 하나만 조용히 공개된다. */
const sharedReadPaths: readonly (readonly [string, string])[] = [
  ["열린 공고 목록", auctionV1Operations.listOpen.buildPath({ path: {}, query: undefined })],
  ["공고 상세", auctionV1Operations.find.buildPath({ path: { auctionId: AUCTION_ID } })],
  ["회차 명단", auctionV1Operations.roster.buildPath({ path: { auctionId: AUCTION_ID }, query: {} })],
  [
    "기관 회차 이력",
    organizationV1Operations.listAuctionAttempts.buildPath({ path: { organizationId: "41" } }),
  ],
  [
    "낙찰률 분포",
    winRateDistributionV1Operations.find.buildPath({
      path: {},
      query: { scope: "national", floorRate: "90.000", awardMethod: "31" },
    }),
  ],
  [
    "코드 목록",
    codeSchemeV1Operations.listCodes.buildPath({
      path: { scheme: "eat:auction-location-sido" },
      query: {},
    }),
  ],
];

async function withServer(
  options: Pick<CreateAppOptions, "sessionAuthenticator">,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    ...options,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

describe("공유 read 로그인 게이트", () => {
  test("미로그인 요청은 공유 read 전부에서 401 Problem Details를 받는다", async () => {
    await withServer({ sessionAuthenticator: anonymousSessionAuthenticator }, async (server) => {
      for (const [label, path] of sharedReadPaths) {
        const response = await request(server).get(path);
        expect([label, response.status]).toEqual([label, 401]);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.body).toMatchObject({
          status: 401,
          code: "UNAUTHENTICATED",
        });
        // 재로그인 안내를 만들려면 소비자가 이 응답을 상관관계 ID와 함께 남길 수 있어야 한다.
        expect(typeof response.body.requestId).toBe("string");
        expect(response.body.requestId.length).toBeGreaterThan(0);
        // 게이트 뒤로 옮겨진 read는 개인 응답이다. guard가 끊은 401도 공유 캐시에 남으면 안 된다.
        expect([label, response.headers["cache-control"]]).toEqual([label, "private, no-store"]);
        expect([label, (response.headers["vary"] ?? "").toLowerCase()]).toEqual([label, expect.stringContaining("cookie")]);
      }
    });
  });

  test("인증을 켜지 않은 배포는 미로그인 401이 아니라 의존성 없음 503으로 답한다", async () => {
    // 둘을 같은 401로 합치면 로그인 자체가 불가능한 배포에서 사용자가 재로그인을 반복한다.
    await withServer({}, async (server) => {
      for (const [label, path] of sharedReadPaths) {
        const response = await request(server).get(path);
        expect([label, response.status]).toEqual([label, 503]);
        expect([label, response.headers["cache-control"]]).toEqual([label, "private, no-store"]);
      }
    });
  });

  test("유효한 세션이 있으면 게이트를 지나 handler의 응답 계약에 도달한다", async () => {
    await withServer({ sessionAuthenticator: signedInSessionAuthenticator }, async (server) => {
      // reader를 주입하지 않았으므로 DB에 닿는 handler는 503이다. 확인하려는 것은 게이트를 지났다는
      // 사실이고, 그 증거는 401이 아니라는 것이다.
      for (const [label, path] of sharedReadPaths) {
        const response = await request(server).get(path);
        expect([label, response.status === 401]).toEqual([label, false]);
      }
    });
  }, 30_000);
});
