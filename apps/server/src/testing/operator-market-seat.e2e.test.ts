import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { operatorMarketSeatV1Operations } from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";

import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type { AccountRepository } from "../modules/account/application/account-repository";
import type { MarketSeatAdminStore, MarketSeatRecord } from "../modules/entitlement/application/market-seat-admin-store";
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

const seat: MarketSeatRecord = {
  marketSeatId: 9_007_199_254_740_993n,
  workspace: { workspaceId: 1n, name: "오뚜기축산", businessNumbers: ["1248100998"] },
  region: { codeValueId: 9_007_199_254_740_995n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" },
  item: { kind: "no-main-item-restriction" },
  state: "active",
  startsAt: Temporal.Instant.from("2026-11-05T03:00:00Z"),
  endsAt: Temporal.Instant.from("2027-02-04T15:00:00Z"),
  priorityStartedAt: Temporal.Instant.from("2026-11-05T03:00:00Z"),
  events: [{
    kind: "activated", occurredAt: Temporal.Instant.from("2026-11-05T03:00:00Z"), reason: "pilot", memo: null,
    actorPrincipalId: 11n, previousEndsAt: null, nextEndsAt: Temporal.Instant.from("2027-02-04T15:00:00Z"),
  }],
};

function fakeStore(calls: unknown[]): MarketSeatAdminStore {
  return {
    listSeats: async () => [seat],
    listWorkspaces: async () => [seat.workspace],
    grant: async (input) => {
      calls.push(input);
      return {
        kind: "rejected",
        rejection: { reason: "period-overlap", holder: { workspaceId: 1n, name: "오뚜기축산" }, holderEndsAt: seat.endsAt },
      };
    },
    extend: async () => null,
    revoke: async () => ({ kind: "saved", seat }),
  };
}

async function withServer(
  options: { readonly grants: OperatorGrantReader; readonly store: MarketSeatAdminStore },
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    accountRepository,
    operatorGrantReader: options.grants,
    marketSeatAdminStore: options.store,
    sessionAuthenticator: signedInSessionAuthenticator,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

// 변경 명령은 신뢰한 Origin에서만 받는다. 403의 두 이유(Origin·운영자 권한)를 섞지 않으려고 운영자 거절 시험도 Origin을 보낸다.
const origin = "http://localhost:3000";
const operations = operatorMarketSeatV1Operations;
const listPath = operations.listOperatorMarketSeats.buildPath({});
const grantPath = operations.grantMarketSeat.buildPath({});

describe("운영자 시장 자리 HTTP 경계", () => {
  test("운영자 권한이 없으면 목록도 명령도 403이고 저장소를 부르지 않는다", async () => {
    const calls: unknown[] = [];
    await withServer({ grants: { hasActiveGrant: async () => false }, store: fakeStore(calls) }, async (server) => {
      expect((await request(server).get(listPath)).status).toBe(403);
      expect((await request(server).post(grantPath).set("origin", origin).send({
        workspaceId: "1", regionCodeValueId: "2", item: { kind: "atom", atom: "육류" }, startDate: "2099-01-01", months: 1, reason: "pilot",
      })).status).toBe(403);
      expect(calls).toEqual([]);
    });
  });

  test("목록은 번호를 텍스트로, 품목 제한 없음을 품목 칸으로 낸다", async () => {
    await withServer({ grants: { hasActiveGrant: async () => true }, store: fakeStore([]) }, async (server) => {
      const response = await request(server).get(listPath);
      expect(response.status).toBe(200);
      expect(response.body.seats[0]).toMatchObject({
        marketSeatId: "9007199254740993",
        workspace: { workspaceId: "1", name: "오뚜기축산", businessNumbers: ["1248100998"] },
        region: { codeValueId: "9007199254740995", label: "경남/김해시" },
        item: { kind: "no-main-item-restriction" },
        endsAt: "2027-02-04T15:00:00Z",
      });
      expect(response.body.seats[0].events[0]).toMatchObject({ kind: "activated", actorPrincipalId: "11" });
    });
  });

  test("자리 주기의 거절은 200 결과로 겹친 업체를 말하고, 행위자는 body가 아니라 세션에서 온다", async () => {
    const calls: Array<{ readonly note: { readonly actorPrincipalId: bigint } }> = [];
    await withServer({ grants: { hasActiveGrant: async () => true }, store: fakeStore(calls as unknown[]) }, async (server) => {
      const response = await request(server).post(grantPath).set("origin", origin).send({
        workspaceId: "1", regionCodeValueId: "9007199254740995", item: { kind: "atom", atom: "육류" },
        startDate: "2099-01-01", months: 3, reason: "pilot",
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        kind: "rejected",
        rejection: { reason: "period-overlap", holder: { workspaceId: "1", name: "오뚜기축산" }, holderEndsAt: "2027-02-04T15:00:00Z" },
      });
      expect(calls[0]?.note.actorPrincipalId).toBe(11n);
      // 계약 밖 개월 수와 모르는 사유는 400이다.
      expect((await request(server).post(grantPath).set("origin", origin).send({
        workspaceId: "1", regionCodeValueId: "2", item: { kind: "atom", atom: "육류" }, startDate: "2099-01-01", months: 13, reason: "pilot",
      })).status).toBe(400);
    });
  });

  test("없는 자리를 늘리면 404이고 거두기는 저장된 자리를 돌려준다", async () => {
    await withServer({ grants: { hasActiveGrant: async () => true }, store: fakeStore([]) }, async (server) => {
      const extendPath = operations.extendMarketSeat.buildPath({ path: { marketSeatId: "5" } });
      expect((await request(server).post(extendPath).set("origin", origin).send({ months: 1, reason: "pilot" })).status).toBe(404);
      const revokePath = operations.revokeMarketSeat.buildPath({ path: { marketSeatId: "9007199254740993" } });
      const revoked = await request(server).post(revokePath).set("origin", origin).send({ reason: "refund-request", memo: "환불 요청" });
      expect(revoked.status).toBe(200);
      expect(revoked.body.kind).toBe("saved");
    });
  });
});
