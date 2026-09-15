import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { baseRelativeBidRate, bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OpenAuctionQuery,
  OpenAuctionReader,
  OpenAuctionRecord,
} from "../modules/procurement/application/open-auction-reader";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const record: OpenAuctionRecord = {
  auctionAttemptId: 9_007_199_254_740_993n,
  organization: { organizationId: 3_101n, label: "창원 남산초등학교", type: "unknown" },
  itemLabel: "축산",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  region: {
    sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시" },
  },
  eligibilityAreas: [{ codeValueId: 9_101n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" }],
  termsRevisionId: 5_796_469n,
  closesAt: Temporal.Instant.from("2026-09-08T02:00:00Z"),
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  bidCount: 5,
  observedAt: Temporal.Instant.from("2026-09-07T00:30:00Z"),
  sourceLastChangedAt: Temporal.Instant.from("2026-09-06T23:00:00Z"),
  orgSummary: {
    attemptCount: 17,
    medianListCount: 5,
    listCountSampleCount: 12,
    lastRound: {
      auctionAttemptId: 5_780_681n,
      openedAt: Temporal.Instant.from("2026-09-02T02:00:00Z"),
      awardedBidRate: baseRelativeBidRate(canonicalDecimal("88.3020", 4)),
      dayFloorBidRate: baseRelativeBidRate(canonicalDecimal("88.0350", 4)),
      listCount: 17,
      belowDayFloorCount: 2,
    },
  },
};

const lineage = {
  buildId: 601n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

// "열림" 기준 시각은 서버의 주입 clock이다. 고정해야 reader가 받은 기준과 meta.asOf를 문자 그대로 검사한다.
const NOW = Temporal.Instant.from("2026-09-07T01:30:00Z");

const environment = parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});

const listPath = (query?: Parameters<typeof auctionV1Operations.listOpen.buildPath>[0]["query"]): string =>
  auctionV1Operations.listOpen.buildPath({ path: {}, query });

async function withServer(reader: OpenAuctionReader, run: (server: Server) => Promise<void>): Promise<void> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    openAuctionReader: reader,
    clock: fixedClock(NOW),
    sessionAuthenticator: signedInSessionAuthenticator,
  } as never);
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    await run(server);
  } finally {
    await runtime.shutdown();
  }
}

describe("열린 공고 목록 HTTP 경로", () => {
  test("열린 공고 목록은 200과 계약 응답을 내고 query 기본값을 적용한다", async () => {
    const observed: OpenAuctionQuery[] = [];
    await withServer({
      listOpen: async (query) => {
        observed.push(query);
        return {
          kind: "page",
          page: {
            auctions: [record],
            nextCursor: 9_007_199_254_740_993n,
            sampleCount: 70,
            eligibilityMatchedCount: 0,
            eligibilityUnobservedCount: 0,
            snapshotLineage: lineage,
            orgSummaryLineage: lineage,
          },
        };
      },
    }, async (server) => {
      const response = await request(server).get(listPath());
      expect(response.status).toBe(200);
      expect(observed).toEqual([{
        asOf: NOW,
        sidoCodeValueId: null,
        sigunguCodeValueIds: null,
        eligibilityAreaCodeValueIds: null,
        itemLabels: null,
        includeUnknownItem: false,
        onlyWithoutBids: false,
        closesWithinHours: null,
        closesOnKst: null,
        announcedOnKst: null,
        baseAmountMin: null,
        baseAmountMax: null,
        cursor: null,
        limit: 50,
      }] as never);
      expect(response.body.auctions).toEqual([{
        auctionAttemptId: "9007199254740993",
        organization: { organizationId: "3101", label: "창원 남산초등학교", type: "unknown" },
        itemLabel: "축산",
        floorRate: { value: "90.000", unit: "percentage-points" },
        region: {
          sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
          sigungu: { codeValueId: "43", code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시" },
        },
        eligibilityAreas: [{ codeValueId: "9101", code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" }],
        termsRevisionId: "5796469",
        closesAt: "2026-09-08T02:00:00Z",
        baseAmount: { amount: "2761700.00", currency: "KRW" },
        bidCount: 5,
        observedAt: "2026-09-07T00:30:00Z",
        sourceLastChangedAt: "2026-09-06T23:00:00Z",
        orgSummary: {
          attemptCount: 17,
          medianListCount: 5,
          listCountSampleCount: 12,
          lastRound: {
            auctionAttemptId: "5780681",
            openedAt: "2026-09-02T02:00:00Z",
            awardedBidRate: { value: "88.3020", unit: "percentage-points" },
            dayFloorBidRate: { value: "88.0350", unit: "percentage-points" },
            listCount: 17,
            belowDayFloorCount: 2,
          },
        },
      }]);
      expect(response.body.nextCursor).toBe("9007199254740993");
      expect(response.body.meta).toMatchObject({
        sampleCount: 70,
        asOf: "2026-09-07T01:30:00Z",
        openAuctionSnapshotBuild: { buildId: "601", calcVersion: "mart-r2" },
        orgRoundSummaryBuild: { buildId: "601", calcVersion: "mart-r2" },
      });
    });
  });

  test("지역·품목·참여·기간·기초금액·cursor·limit query를 손실 없이 use case 입력으로 옮긴다", async () => {
    const observed: OpenAuctionQuery[] = [];
    await withServer({
      listOpen: async (query) => {
        observed.push(query);
        return {
          kind: "page",
          page: {
            auctions: [],
            nextCursor: null,
            sampleCount: 0,
            eligibilityMatchedCount: 0,
            eligibilityUnobservedCount: 0,
            snapshotLineage: null,
            orgSummaryLineage: null,
          },
        };
      },
    }, async (server) => {
      const response = await request(server).get(listPath({
        sido: "9007199254740993",
        sigungu: ["9201", "9202"],
        eligibilityArea: ["9101", "9100"],
        items: ["축산", "가금류"],
        itemUnknown: "include",
        bidState: "none",
        closesWithinHours: 72,
        baseAmountMin: "2000000.00",
        baseAmountMax: "3000000.00",
        cursor: "5796468",
        limit: 100,
      }));
      expect(response.status).toBe(200);
      expect(observed).toEqual([{
        asOf: NOW,
        // bigint 경계를 넘는 시도 id가 문자열로 와서 손실 없이 변환되는 것을 이 자리가 지킨다.
        sidoCodeValueId: 9_007_199_254_740_993n,
        sigunguCodeValueIds: [9_201n, 9_202n],
        eligibilityAreaCodeValueIds: [9_101n, 9_100n],
        itemLabels: ["축산", "가금류"],
        includeUnknownItem: true,
        onlyWithoutBids: true,
        closesWithinHours: 72,
        closesOnKst: null,
        announcedOnKst: null,
        baseAmountMin: "2000000.00",
        baseAmountMax: "3000000.00",
        cursor: 5_796_468n,
        limit: 100,
      }] as never);
      // 목록이 비어도 요청 필터는 되돌아와야 표본 0이 어느 코호트의 0인지 응답만으로 닫힌다.
      expect(response.body.meta).toEqual({
        sampleCount: 0,
        asOf: "2026-09-07T01:30:00Z",
        sido: "9007199254740993",
        sigungu: ["9201", "9202"],
        eligibilityArea: ["9101", "9100"],
        eligibilityMatchedCount: 0,
        eligibilityUnobservedCount: 0,
        items: ["축산", "가금류"],
        itemUnknown: "include",
        bidState: "none",
        closesWithinHours: 72,
        closesOn: null,
        announcedOn: null,
        baseAmountMin: "2000000.00",
        baseAmountMax: "3000000.00",
        openAuctionSnapshotBuild: { buildId: null, sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null },
        orgRoundSummaryBuild: { buildId: null, sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null },
      });
    });
  });

  test("알 수 없는 query key와 범위 밖 값은 repository 앞에서 400 Problem Details다", async () => {
    let calls = 0;
    await withServer({
      listOpen: async () => {
        calls += 1;
        return { kind: "page", page: { auctions: [], nextCursor: null, sampleCount: 0, snapshotLineage: null, orgSummaryLineage: null } };
      },
    }, async (server) => {
      for (const invalid of [
        "state=closed", "sort=closesAt", "limit=0", "limit=201", "closesWithinHours=0", "closesWithinHours=721",
        "baseAmountMin=2000000", "sido=0", "cursor=01", "item=",
        // 계약이 타입으로 못 막는 조합 둘. 시군구만 오면 어느 시도 안인지 알 수 없고, 달력일과 시간
        // 창을 함께 보내면 두 축이 서로 다른 창을 뜻한다(EAT-206).
        "sigungu=43", "closesOn=2026-09-07&closesWithinHours=72",
        "closesOn=2026-9-7", "announcedOn=20260907",
      ]) {
        const response = await request(server).get(`/api/v1/auctions?${invalid}`);
        expect(response.status, invalid).toBe(400);
        expect(response.body.code, invalid).toBe("VALIDATION_ERROR");
      }
      expect(calls).toBe(0);
    });
  });

  test("활성 build에 없는 cursor는 빈 목록이 아니라 400 VALIDATION_ERROR다", async () => {
    await withServer({
      listOpen: async (query) => ({ kind: "cursor-not-found", cursor: query.cursor ?? 0n }),
    }, async (server) => {
      const response = await request(server).get(listPath({ cursor: "9007199254740993" }));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  test("데이터베이스를 쓸 수 없으면 503 DEPENDENCY_UNAVAILABLE이고 원문을 숨긴다", async () => {
    await withServer({
      listOpen: async () => { throw new Error("database offline"); },
    }, async (server) => {
      const response = await request(server).get(listPath());
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toContain("database offline");
    });
  });

  test("repository 값이 공개 계약 상한을 넘으면 fail-closed한다", async () => {
    await withServer({
      listOpen: async () => ({
        kind: "page",
        page: {
          auctions: [{ ...record, itemLabel: "축".repeat(513) }],
          nextCursor: null,
          sampleCount: 1,
          snapshotLineage: lineage,
          orgSummaryLineage: lineage,
        },
      }),
    }, async (server) => {
      const response = await request(server).get(listPath());
      expect(response.status).toBe(500);
      expect(response.body.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(response.body)).not.toContain("축".repeat(513));
    });
  });
});
