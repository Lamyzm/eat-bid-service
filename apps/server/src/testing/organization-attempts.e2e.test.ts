import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { organizationV1Operations } from "@eatbid/contracts";
import { canonicalDecimal, krw, percentagePoints, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OrganizationAttemptQuery,
  OrganizationAttemptReader,
} from "../modules/procurement/application/organization-attempt-reader";

const attempt = {
  attemptId: 9_007_199_254_740_993n,
  announcedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  openedAt: Temporal.Instant.from("2026-09-02T02:00:00Z"),
  item: { codeValueId: 7n, label: "축산" },
  floorRate: percentagePoints(canonicalDecimal("90.000", 3)),
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  winRate: percentagePoints(canonicalDecimal("90.309", 3)),
  secondRate: null,
  dayFloorRate: null,
  listCount: 17,
  invalidCount: 2,
  winnerSupplierPartyId: 9n,
  supersedesAttemptId: null,
  martRelease: "2026-09-04T00",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  calcVersion: "v1",
} as const;

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const attemptsPath = (
  organizationId: string,
  query?: { item?: string; cursor?: string; limit?: number },
): string => organizationV1Operations.listAuctionAttempts.buildPath({
  path: { organizationId },
  query,
});

async function withServer(
  reader: OrganizationAttemptReader,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    organizationAttemptReader: reader,
  } as never);
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

describe("기관 회차 이력 HTTP 경로", () => {
  test("bigint ID와 회차 값을 제한된 JSON으로 왕복 보존하고 query 기본값을 적용한다", async () => {
    const observed: OrganizationAttemptQuery[] = [];
    await withServer({
      exists: async () => true,
      listAttempts: async (query) => {
        observed.push(query);
        return {
          kind: "page",
          page: { attempts: [attempt], nextCursor: 9_007_199_254_740_993n, sampleCount: 92 },
        };
      },
    }, async (server) => {
      const response = await request(server).get(attemptsPath("9007199254740993"));
      expect(response.status).toBe(200);
      expect(observed).toEqual([{
        organizationId: 9_007_199_254_740_993n,
        itemCodeValueId: null,
        cursor: null,
        limit: 12,
      }] as never);
      expect(response.body).toEqual({
        organizationId: "9007199254740993",
        attempts: [{
          attemptId: "9007199254740993",
          announcedAt: "2026-09-01T00:00:00Z",
          openedAt: "2026-09-02T02:00:00Z",
          item: { codeValueId: "7", label: "축산" },
          floorRate: { value: "90.000", unit: "percentage-points" },
          baseAmount: { amount: "2761700.00", currency: "KRW" },
          winRate: { value: "90.309", unit: "percentage-points" },
          secondRate: null,
          dayFloorRate: null,
          listCount: 17,
          invalidCount: 2,
          winnerSupplierPartyId: "9",
          supersedesAttemptId: null,
        }],
        nextCursor: "9007199254740993",
        meta: {
          sampleCount: 92,
          martRelease: "2026-09-04T00",
          computedAt: "2026-09-04T00:10:00Z",
          calcVersion: "v1",
        },
      });
    });
  });

  test("item·cursor·limit query를 손실 없이 use case 입력으로 옮긴다", async () => {
    const observed: OrganizationAttemptQuery[] = [];
    await withServer({
      exists: async () => true,
      listAttempts: async (query) => {
        observed.push(query);
        return { kind: "page", page: { attempts: [], nextCursor: null, sampleCount: 0 } };
      },
    }, async (server) => {
      const response = await request(server).get(attemptsPath("42", {
        item: "7",
        cursor: "9007199254740993",
        limit: 200,
      }));
      expect(response.status).toBe(200);
      expect(observed).toEqual([{
        organizationId: 42n,
        itemCodeValueId: 7n,
        cursor: 9_007_199_254_740_993n,
        limit: 200,
      }] as never);
      expect(response.body.meta).toEqual({
        sampleCount: 0,
        martRelease: null,
        computedAt: null,
        calcVersion: null,
      });
    });
  });

  test("비정상 ID와 query는 repository 앞에서 400으로 거부한다", async () => {
    let calls = 0;
    const reader: OrganizationAttemptReader = {
      exists: async () => { calls += 1; return true; },
      listAttempts: async () => {
        calls += 1;
        return { kind: "page", page: { attempts: [], nextCursor: null, sampleCount: 0 } };
      },
    };
    await withServer(reader, async (server) => {
      for (const invalid of ["0", "01", "-1", "1.0", "9223372036854775808", "seoul-office"]) {
        const response = await request(server).get(`/api/v1/organizations/${invalid}/auction-attempts`);
        expect(response.status, invalid).toBe(400);
        expect(response.body.code, invalid).toBe("VALIDATION_ERROR");
      }
      for (const invalid of ["limit=0", "limit=201", "limit=abc", "item=0", "cursor=01", "unknown=1"]) {
        const response = await request(server).get(`/api/v1/organizations/42/auction-attempts?${invalid}`);
        expect(response.status, invalid).toBe(400);
        expect(response.body.code, invalid).toBe("VALIDATION_ERROR");
      }
      expect(calls).toBe(0);
    });
  });

  test("없는 기관과 저장소 장애를 서로 다른 상태로 매핑하고 원문을 숨긴다", async () => {
    await withServer({
      exists: async () => false,
      listAttempts: async () => { throw new Error("unreachable"); },
    }, async (server) => {
      const response = await request(server).get(attemptsPath("42"));
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
    });
    await withServer({
      exists: async () => { throw new Error("database offline"); },
      listAttempts: async () => { throw new Error("database offline"); },
    }, async (server) => {
      const response = await request(server).get(attemptsPath("42"));
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toContain("database offline");
    });
  });

  test("소유자가 다른 cursor는 빈 목록이 아니라 400 VALIDATION_ERROR로 닫는다", async () => {
    await withServer({
      exists: async () => true,
      listAttempts: async (query) => ({ kind: "cursor-not-found", cursor: query.cursor ?? 0n }),
    }, async (server) => {
      const response = await request(server).get(attemptsPath("42", { cursor: "9007199254740993" }));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  test("repository 값이 공개 계약 상한을 넘으면 fail-closed한다", async () => {
    await withServer({
      exists: async () => true,
      listAttempts: async () => ({
        kind: "page",
        page: {
          attempts: [{ ...attempt, item: { codeValueId: 7n, label: "축".repeat(129) } }],
          nextCursor: null,
          sampleCount: 1,
        },
      }),
    }, async (server) => {
      const response = await request(server).get(attemptsPath("42"));
      expect(response.status).toBe(500);
      expect(response.body.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(response.body)).not.toContain("축".repeat(129));
    });
  });
});
