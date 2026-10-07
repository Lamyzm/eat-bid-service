// docker 없이 Nest ingress만 세우고 운영자 guard·계약 경로·응답 schema를 실제 HTTP로 확인한다. 저장소는 주입한 port다.
import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type { AccountRepository } from "../modules/account/application/account-repository";
import type { AuctionReader, AuctionRecord } from "../modules/procurement/application/auction-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";
import type { OperatorGrantReader } from "../platform/auth/operator-grant-reader";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const auction: AuctionRecord = {
  auctionId: auctionId(9_007_199_254_740_993n),
  revisionId: 9_007_199_254_740_995n,
  title: "김해 육류",
  status: "OPEN",
  displayBidNumber: null,
  announcedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
  deadlineAt: Temporal.Instant.from("2026-10-07T02:00:00Z"),
  openedAt: null,
  baseAmount: krw(canonicalDecimal("17159500.00", 2)),
  plannedAmount: null,
  organization: null,
  terms: { floorRate: bidRate(canonicalDecimal("90.000", 3)), awardMethod: null },
  location: null,
  classification: null,
  participation: {
    latest: { bidCount: 52, observedAt: Temporal.Instant.from("2026-10-07T01:00:00Z") },
    dayEarlier: null,
  },
  latestObservation: { state: "reflected" },
  provenance: {
    sourceSystem: "eat",
    externalBidId: "external-opaque-id",
    observationId: 6n,
    normalizedRecordId: 7n,
    contentSha256: "a".repeat(64),
  },
};

const accountRepository = {
  findPrincipalBySubject: async () => ({
    principalId: 11n,
    workspace: { workspaceId: 7n, name: "내 워크스페이스", role: "owner" as const },
  }),
} as unknown as AccountRepository;

const path = auctionV1Operations.bidPosition.buildPath({ path: { auctionId: "9007199254740993" } });

async function withServer(
  options: { readonly reader?: AuctionReader; readonly grants: OperatorGrantReader },
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    auctionReader: options.reader ?? { findById: async () => auction },
    accountRepository,
    operatorGrantReader: options.grants,
    sessionAuthenticator: signedInSessionAuthenticator,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

const granted: OperatorGrantReader = { hasActiveGrant: async () => true };

describe("추천 투찰가 HTTP 경계", () => {
  test("운영자 권한이 있으면 원 단위 금액과 규칙 근거를 함께 낸다", async () => {
    const asked: bigint[] = [];
    await withServer({ grants: { hasActiveGrant: async (principalId) => { asked.push(principalId); return true; } } }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(200);
      expect(asked).toEqual([11n]);
      expect(response.body.auctionId).toBe("9007199254740993");
      expect(response.body.rule).toEqual({
        version: "2026-10-07", trainedThrough: "2025-12", validatedFrom: "2026-01", validatedThrough: "2026-08",
      });
      expect(response.body.result.state).toBe("applicable");
      expect(response.body.result.band).toBe("40-69");
      expect(response.body.result.selection).toBe("validation-informed");
      expect(response.body.result.holdout).toEqual({
        month: "2026-09", rounds: 869, tickets: 2, wins: 41, lotteryExpectedWins: "33.7",
      });
      expect(response.body.result.positions[0]).toEqual({
        order: 1,
        amount: { amount: "15219619.00", currency: "KRW" },
        baseRelativeRate: { value: "88.6950", unit: "percentage-points" },
        cumulativeWinRate: { value: "2.260870", unit: "percentage-points" },
        cumulativeLotteryWinRate: { value: "1.787757", unit: "percentage-points" },
        cumulativeValidationWins: 78,
      });
      expect(response.body.participation).toEqual({ bidCount: 52, observedAt: "2026-10-07T01:00:00Z" });
    });
  });

  test("운영자 권한이 없으면 403이고 공고를 읽지 않는다", async () => {
    let reads = 0;
    await withServer({
      grants: { hasActiveGrant: async () => false },
      reader: { findById: async () => { reads++; return auction; } },
    }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(reads).toBe(0);
    });
  });

  test("권한 조회 장애는 403이 아니라 503이다", async () => {
    await withServer({ grants: { hasActiveGrant: async () => { throw new Error("private grant failure"); } } }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain("private");
    });
  });

  test("참여 40곳 미만이면 금액 없이 사유만 낸다", async () => {
    const few: AuctionRecord = {
      ...auction,
      participation: { latest: { bidCount: 39, observedAt: Temporal.Instant.from("2026-10-07T01:00:00Z") }, dayEarlier: null },
    };
    await withServer({ grants: granted, reader: { findById: async () => few } }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(200);
      expect(response.body.result).toEqual({ state: "not-applicable", reason: "participation-below-rule" });
    });
  });

  test("없는 공고와 저장소 장애를 404와 503으로 나눈다", async () => {
    for (const [reader, status] of [
      [{ findById: async () => null }, 404],
      [{ findById: async () => { throw new Error("private connection failure"); } }, 503],
    ] as const) {
      await withServer({ grants: granted, reader }, async (server) => {
        const response = await request(server).get(path);
        expect(response.status).toBe(status);
        expect(JSON.stringify(response.body)).not.toContain("private");
      });
    }
  });
});
