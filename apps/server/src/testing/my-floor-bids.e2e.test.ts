// docker 없이 Nest ingress만 세우고 하한선 자리 내 투찰 조회의 운영자 guard·query 검증을 실제 HTTP로 확인한다.
import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { myFloorBidV1Operations } from "@eatbid/contracts";

import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type { AccountRepository } from "../modules/account/application/account-repository";
import type { OperatorGrantReader } from "../platform/auth/operator-grant-reader";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const accountRepository = {
  findPrincipalBySubject: async () => ({
    principalId: 11n,
    workspace: { workspaceId: 7n, name: "내 워크스페이스", role: "owner" as const },
  }),
} as unknown as AccountRepository;

const path = myFloorBidV1Operations.findMyFloorBids.openApiPath;
const 창 = new URLSearchParams({
  from: "2025-10-01",
  to: "2026-09-30",
  floorRate: "90.000",
  regionScheme: "eat:auction-location-sigungu",
  regionCodeValueId: "459",
});

async function withServer(grants: OperatorGrantReader, run: (server: Server) => Promise<void>): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    accountRepository,
    operatorGrantReader: grants,
    sessionAuthenticator: signedInSessionAuthenticator,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

describe("하한선 자리 내 투찰 HTTP 경계", () => {
  test("운영자 권한이 없으면 403이다", async () => {
    await withServer({ hasActiveGrant: async () => false }, async (server) => {
      const response = await request(server).get(`${path}?${창}`);
      expect(response.status).toBe(403);
    });
  });

  test("운영자라도 시도 체계나 기간 상한을 어기면 400이다", async () => {
    await withServer({ hasActiveGrant: async () => true }, async (server) => {
      const sido = new URLSearchParams(창);
      sido.set("regionScheme", "eat:auction-location-sido");
      expect((await request(server).get(`${path}?${sido}`)).status).toBe(400);
      const long = new URLSearchParams(창);
      long.set("from", "2023-01-01");
      expect((await request(server).get(`${path}?${long}`)).status).toBe(400);
    });
  });
});
