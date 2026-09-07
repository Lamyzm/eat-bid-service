import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type { AuctionReader } from "../modules/procurement/application/auction-reader";

const publicAuction = {
  auctionId: 9_007_199_254_740_993n,
  revisionId: 9_007_199_254_740_995n,
  title: "Fresh produce supply",
  status: "OPEN",
  displayBidNumber: null,
  announcedAt: Temporal.Instant.from("2026-08-30T00:00:00.123456789Z"),
  deadlineAt: null,
  openedAt: null,
  baseAmount: krw(canonicalDecimal("1234567890.50", 2)),
  plannedAmount: null,
  organization: { organizationId: 7n, name: "서울특별시교육청", type: "education-office" },
  terms: { floorRate: "90.000", awardMethod: null },
  location: {
    sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: null,
  },
  classification: { itemLabel: "축산" },
  participation: null,
  provenance: {
    sourceSystem: "eat",
    externalBidId: "external-opaque-id",
    observationId: 9_007_199_254_740_997n,
    normalizedRecordId: 9_007_199_254_740_999n,
    contentSha256: "a".repeat(64),
  },
} as const;

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const auctionPath = (auctionId: string): string => auctionV1Operations.find.buildPath({
  path: { auctionId },
});

async function withServer(
  reader: AuctionReader,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    auctionReader: reader,
  } as never);
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

describe("canonical procurement HTTP 경로", () => {
  test("MAX_SAFE_INTEGER를 넘는 bigint를 path·application·제한 JSON에서 왕복 보존한다", async () => {
    const observed: bigint[] = [];
    await withServer({
      findById: async (id) => {
        observed.push(id);
        return publicAuction;
      },
    }, async (server) => {
      const response = await request(server).get(auctionPath("9007199254740993"));
      expect(response.status).toBe(200);
      expect(observed).toEqual([9_007_199_254_740_993n]);
      expect(response.body).toEqual({
        identity: {
          auctionId: "9007199254740993",
          revisionId: "9007199254740995",
          externalBidId: "external-opaque-id",
          displayBidNumber: null,
          title: "Fresh produce supply",
          status: "OPEN",
        },
        organization: { organizationId: "7", name: "서울특별시교육청", type: "education-office" },
        schedule: {
          announcedAt: "2026-08-30T00:00:00.123456789Z",
          deadlineAt: null,
          openedAt: null,
        },
        pricing: {
          baseAmount: { amount: "1234567890.50", currency: "KRW" },
          plannedAmount: null,
        },
        provenance: {
          sourceSystem: "eat",
          observationId: "9007199254740997",
          normalizedRecordId: "9007199254740999",
          contentSha256: "a".repeat(64),
        },
        // 코호트 재료도 같은 응답에 실린다. 화면이 하한율·소재지를 얻을 다른 경로는 없다.
        terms: { floorRate: { value: "90.000", unit: "percentage-points" }, awardMethod: null },
        location: {
          sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
          sigungu: null,
        },
        classification: { itemLabel: "축산" },
        participation: null,
      });
      expect(response.body).not.toHaveProperty("sourcePayload");
    });
  });

  test("PostgreSQL bigint 최댓값을 왕복 보존하고 상한 초과 값은 repository 전에 거부한다", async () => {
    const observed: bigint[] = [];
    await withServer({
      findById: async (id) => {
        observed.push(id);
        return { ...publicAuction, auctionId: id };
      },
    }, async (server) => {
      const maximum = await request(server).get(auctionPath("9223372036854775807"));
      expect(maximum.status).toBe(200);
      expect(maximum.body.identity.auctionId).toBe("9223372036854775807");
      const oneOver = await request(server).get("/api/v1/auctions/9223372036854775808");
      expect(oneOver.status).toBe(400);
      expect(oneOver.body.code).toBe("VALIDATION_ERROR");
      expect(observed).toEqual([9_223_372_036_854_775_807n]);
    });
  });

  test("모든 non-canonical ID를 repository 전에 거부하고 business key는 수용하지 않는다", async () => {
    let calls = 0;
    await withServer({ findById: async () => { calls += 1; return publicAuction; } }, async (server) => {
      for (const invalid of ["0", "+1", "-1", "%201", "1%20", "01", "1.0", "1e3", "external-opaque-id"]) {
        const response = await request(server).get(`/api/v1/auctions/${invalid}`);
        expect(response.status, invalid).toBe(400);
        expect(response.body.code, invalid).toBe("VALIDATION_ERROR");
      }
      expect(calls).toBe(0);
    });
  });

  test("typed not-found와 dependency unavailable을 서로 다르게 매핑한다", async () => {
    await withServer({ findById: async () => null }, async (server) => {
      const response = await request(server).get(auctionPath("41"));
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("AUCTION_NOT_FOUND");
    });
    await withServer({ findById: async () => { throw new Error("database offline"); } }, async (server) => {
      const response = await request(server).get(auctionPath("41"));
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toContain("database offline");
    });
  });

  test("repository 값이 공개 계약 상한을 넘으면 fail-closed한다", async () => {
    await withServer({
      findById: async () => ({ ...publicAuction, title: "t".repeat(513) }),
    }, async (server) => {
      const response = await request(server).get(auctionPath("41"));
      expect(response.status).toBe(500);
      expect(response.body.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(response.body)).not.toContain("t".repeat(513));
    });
  });
});
