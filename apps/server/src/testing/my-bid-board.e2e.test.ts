// docker 없이 Nest ingress만 세우고 운영자 guard·계약 경로·응답 schema를 실제 HTTP로 확인한다. 저장소는 주입한 port다.
import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { myBidBoardV1Operations, myBidBoardV1ResponseSchema } from "@eatbid/contracts";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type { AccountRepository } from "../modules/account/application/account-repository";
import type { RegionPreferenceRecord, RegionPreferenceRepository } from "../modules/account/application/region-preference-repository";
import type { OpenAuctionReader, OpenAuctionRecord } from "../modules/procurement/application/open-auction-reader";
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

const row: OpenAuctionRecord = {
  auctionAttemptId: 2_797_346n,
  organization: { organizationId: 1n, label: "주촌초등학교", type: "school" },
  itemLabel: "육류 , 가금류",
  title: "(주촌초등학교) 2026년 11월 식재료(육류) 구입 소액수의 공고",
  displayBidNo: "G2026-1013",
  soloBidMethod: null,
  changeKind: null,
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  region: null,
  eligibilityAreas: null,
  termsRevisionId: 9n,
  closesAt: Temporal.Instant.from("2026-10-13T01:00:00Z"),
  baseAmount: krw(canonicalDecimal("8756540.00", 2)),
  bidCount: 52,
  observedAt: Temporal.Instant.from("2026-10-12T00:40:00Z"),
  sourceLastChangedAt: null,
  orgSummary: null,
};

const openAuctionReader: OpenAuctionReader = {
  listOpen: async () => ({
    kind: "page",
    page: {
      auctions: [row], nextCursor: null, sampleCount: 1, eligibilityMatchedCount: 1, eligibilityUnobservedCount: 0,
      snapshotLineage: null, orgSummaryLineage: null,
    },
  }),
};

const regions = (preference: RegionPreferenceRecord) =>
  ({ readPreference: async () => preference }) as unknown as RegionPreferenceRepository;

const kimhae: RegionPreferenceRecord = {
  areas: [{ codeValueId: 15653n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" }],
  confirmedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
};

const path = myBidBoardV1Operations.getMyBidBoard.buildPath({ path: undefined });

async function withServer(
  options: { readonly grants: OperatorGrantReader; readonly preference?: RegionPreferenceRecord; readonly reader?: OpenAuctionReader },
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const runtime = await createApp({
    environment,
    clock: fixedClock(Temporal.Instant.from("2026-10-12T00:47:00Z")),
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => true },
    openAuctionReader: options.reader ?? openAuctionReader,
    regionPreferenceRepository: regions(options.preference ?? kimhae),
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

describe("오늘 투찰 HTTP 경계", () => {
  test("운영자면 관심 지역 공고마다 전국 공식을 내고, DB 없는 맞춤 칸은 계산하지 못했다고 말한다", async () => {
    await withServer({ grants: granted }, async (server) => {
      const response = await request(server).get(`${path}?items=육류&items=가금류`);
      expect(response.status).toBe(200);
      expect(myBidBoardV1ResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body.regionPreference).toBe("confirmed");
      expect(response.body.closesBeforeDate).toBe("2026-10-14");
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].auctionId).toBe("2797346");
      expect(response.body.rows[0].rule.state).toBe("applicable");
      // 이 시험은 DB 없이 돈다. 맞춤 시장 조회가 실패해도 전국 공식은 살아 있다.
      expect(response.body.rows[0].market).toEqual({ state: "not-applicable", reasons: ["market-data-unavailable"] });
      expect(response.body.marketPick).toMatchObject({ state: "not-applicable", reasons: ["market-data-unavailable"], windowMonths: 3 });
    });
  });

  test("관심 지역을 확인하지 않았으면 행 없이 unconfirmed다", async () => {
    await withServer({ grants: granted, preference: { areas: [], confirmedAt: null } }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ regionPreference: "unconfirmed", asOf: "2026-10-12T00:47:00Z", rows: [] });
    });
  });

  test("운영자 권한이 없으면 403이고 공고를 읽지 않는다", async () => {
    let reads = 0;
    const counting: OpenAuctionReader = { listOpen: async (query) => { reads++; return openAuctionReader.listOpen(query); } };
    await withServer({ grants: { hasActiveGrant: async () => false }, reader: counting }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(403);
      expect(reads).toBe(0);
    });
  });

  test("권한 조회 장애는 503이고 어휘 밖 품목은 400이다", async () => {
    await withServer({ grants: { hasActiveGrant: async () => { throw new Error("private grant failure"); } } }, async (server) => {
      const response = await request(server).get(path);
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain("private");
    });
    await withServer({ grants: granted }, async (server) => {
      const response = await request(server).get(`${path}?items=${encodeURIComponent("축산")}`);
      expect(response.status).toBe(400);
    });
  });
});
