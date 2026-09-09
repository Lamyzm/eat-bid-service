import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { winRateDistributionV1Operations } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  WinRateDistributionQuery,
  WinRateDistributionReader,
} from "../modules/procurement/application/win-rate-distribution-reader";
import { kstMonth } from "../modules/procurement/domain/kst-month";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const clock = fixedClock(Temporal.Instant.from("2026-09-06T01:00:00Z"));

const lineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000141",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const distributionPath = (query: Record<string, string | undefined>): string =>
  winRateDistributionV1Operations.find.buildPath({ path: {}, query: query as never });

/**
 * 계약이 거부하는 query는 `buildPath`로 만들 수 없다. 경로 자체는 계약에서 파생하고 query 문자열만
 * 직접 붙여 transport 경계가 그 위반을 400으로 닫는지 본다.
 */
const rejectedPath = (query: Record<string, string>): string => {
  const [base] = distributionPath({ scope: "national", floorRate: "90.000", awardMethod: "31" }).split("?");
  return `${base}?${new URLSearchParams(query).toString()}`;
};

async function withServer(
  reader: WinRateDistributionReader,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    clock,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    winRateDistributionReader: reader,
    sessionAuthenticator: signedInSessionAuthenticator,
  } as never);
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

function readerDouble(overrides: Partial<WinRateDistributionReader> = {}): WinRateDistributionReader {
  return {
    cohortExists: async () => true,
    readDistribution: async () => ({
      months: [{ month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 20 }, { lowerMilli: 90_030n, count: 8 }] }],
      coverage: [{ month: kstMonth("2026-09"), coverage: "unknown" }],
      storedBinWidthMilli: 10n,
      lineage,
    }),
    ...overrides,
  };
}

describe("낙찰률 분포 HTTP 경로", () => {
  test("코호트 query를 application 값으로 옮기고 제한 JSON으로 사다리를 돌려준다", async () => {
    const observed: WinRateDistributionQuery[] = [];
    await withServer(readerDouble({
      readDistribution: async (query) => {
        observed.push(query);
        return {
          months: [{ month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 20 }, { lowerMilli: 90_030n, count: 8 }] }],
          coverage: [{ month: kstMonth("2026-09"), coverage: "unknown" }],
          storedBinWidthMilli: 10n,
          lineage,
        };
      },
    }), async (server) => {
      const response = await request(server).get(distributionPath({
        scope: "national",
        floorRate: "90.000",
        awardMethod: "31",
        from: "2026-09",
        to: "2026-09",
      }));
      expect(response.status).toBe(200);
      expect(observed).toEqual([{
        cohort: { scope: "national" },
        floorRate: "90.000",
        awardMethodCodeValueId: 31n,
        period: { from: "2026-09", to: "2026-09" },
      }]);
      expect(response.body.bins).toEqual([
        { from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" }, count: 20 },
        { from: { value: "90.030", unit: "percentage-points" }, to: { value: "90.040", unit: "percentage-points" }, count: 8 },
      ]);
      expect(response.body.modeRange).toEqual({
        from: { value: "90.000", unit: "percentage-points" },
        to: { value: "90.010", unit: "percentage-points" },
        count: 20,
        share: { value: "0.714286", unit: "ratio" },
      });
      expect(response.body.meta).toMatchObject({
        sampleCount: 28,
        item: null,
        scope: "national",
        buildId: "501",
        coverage: "unknown",
        regionScheme: "eat:auction-location-sigungu",
        period: { from: "2026-09", to: "2026-09" },
      });
    });
  });

  test("기간을 생략하면 주입된 clock의 12개월 창을 응답 meta에 되돌린다", async () => {
    await withServer(readerDouble(), async (server) => {
      const response = await request(server).get(distributionPath({
        scope: "national",
        floorRate: "90.000",
        awardMethod: "31",
      }));
      expect(response.status).toBe(200);
      expect(response.body.meta.period).toEqual({ from: "2025-10", to: "2026-09" });
      expect(response.body.months).toHaveLength(12);
    });
  });

  test("모집단과 축의 짝, 기간 상한, 칸 폭 위반을 Problem Details 400으로 닫는다", async () => {
    await withServer(readerDouble(), async (server) => {
      const cases = [
        { scope: "national", floorRate: "90.000", awardMethod: "31", regionCodeValueId: "41" },
        { scope: "province", floorRate: "90.000", awardMethod: "31" },
        { scope: "national", floorRate: "90.000", awardMethod: "31", from: "2025-09", to: "2026-09" },
        { scope: "national", floorRate: "90.000", awardMethod: "31", binWidth: "0.015" },
        { scope: "national", awardMethod: "31" },
      ];
      for (const query of cases) {
        const response = await request(server).get(rejectedPath(query as Record<string, string>));
        expect(response.status, JSON.stringify(query)).toBe(400);
        expect(response.body).toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
        expect(response.headers["content-type"]).toContain("application/problem+json");
      }
    });
  });

  test("없는 기관과 없는 지역을 서로 다른 404 code로 닫는다", async () => {
    await withServer(readerDouble({ cohortExists: async () => false }), async (server) => {
      const organization = await request(server).get(distributionPath({
        scope: "organization", organizationId: "3101", floorRate: "90.000", awardMethod: "31",
      }));
      expect(organization.status).toBe(404);
      expect(organization.body).toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });

      const region = await request(server).get(distributionPath({
        scope: "district", regionCodeValueId: "43", floorRate: "90.000", awardMethod: "31",
      }));
      expect(region.status).toBe(404);
      expect(region.body).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  test("데이터베이스를 쓸 수 없으면 503 Problem Details로 닫는다", async () => {
    await withServer(readerDouble({
      readDistribution: async () => { throw new Error("connection refused"); },
    }), async (server) => {
      const response = await request(server).get(distributionPath({
        scope: "national", floorRate: "90.000", awardMethod: "31",
      }));
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    });
  });

  test("활성 build가 없어도 200이며 계보 전부 null인 빈 사다리를 돌려준다", async () => {
    await withServer(readerDouble({
      readDistribution: async () => ({ months: [], coverage: [], storedBinWidthMilli: null, lineage: null }),
    }), async (server) => {
      const response = await request(server).get(distributionPath({
        scope: "national", floorRate: "90.000", awardMethod: "31",
      }));
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ bins: [], months: [], medianBin: null, modeRange: null });
      expect(response.body.meta).toMatchObject({ buildId: null, calcVersion: null, coverage: null });
    });
  });
});
