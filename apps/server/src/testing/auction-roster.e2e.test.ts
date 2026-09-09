import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { canonicalDecimal, krw, observedBidRate, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { AuctionRosterIntegrityError, type AuctionRosterReader, type AuctionRosterQuery, type AuctionRosterRecord } from "../modules/procurement/application/auction-roster-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

const environment = parseEnvironment({
  NODE_ENV: "test", PORT: "0",
  DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
});
const record: AuctionRosterRecord = {
  auctionId: auctionId(9_007_199_254_740_993n), revisionId: 99n,
  rows: [{
    submissionId: 9_007_199_254_740_994n, rosterOrdinal: 0,
    supplierPartyId: 3n, sourceSupplierAccountId: 4n, supplierName: "검증 업체",
    amount: krw(canonicalDecimal("1000000000000.01", 2)), effectiveAmount: null,
    bidRate: observedBidRate(canonicalDecimal("100.001", 3)), rank: null, submittedAt: null,
    sourceStatus: { codeValueId: 5n, code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
    withdrawal: null,
  }],
  sourceRosterSize: 2, observedAt: Temporal.Instant.from("2026-09-06T17:18:17.785575Z"),
  provenance: { sourceSystem: "eat", observationId: 6n, normalizedRecordId: 7n, contentSha256: "a".repeat(64) },
  award: null,
};
const path = (revisionId?: string) => auctionV1Operations.roster.buildPath({
  path: { auctionId: "9007199254740993" }, query: { revisionId },
});
async function withServer(reader: AuctionRosterReader, run: (server: Server) => Promise<void>) {
  const runtime = await createApp({
    environment, logWriter: () => undefined, databaseReadiness: { isReady: () => true },
    auctionRosterReader: reader,
    sessionAuthenticator: signedInSessionAuthenticator,
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try { await run(server); } finally { await runtime.shutdown(); }
}
describe("회차 참여 명단 HTTP 경계", () => {
  test("revision과 큰 ID·정확한 금액을 보존하고 공고 참여 수와 명단 수를 구분한다", async () => {
    const seen: AuctionRosterQuery[] = [];
    await withServer({ find: async (query) => { seen.push(query); return record; } }, async (server) => {
      const response = await request(server).get(path("99"));
      expect(response.status).toBe(200);
      expect(seen).toEqual([{ auctionId: record.auctionId, revisionId: 99n }]);
      expect(response.body.rows[0]).toMatchObject({
        submissionId: "9007199254740994", sourceCalculatedAmount: { amount: "1000000000000.01", currency: "KRW" },
        submittedAmount: null,
        bidRate: { value: "100.001", unit: "percentage-points" }, rank: null,
      });
      expect(response.body.meta).toMatchObject({ rowCount: 1, sourceRosterSize: 2 });
      expect(response.body.meta.provenance.observationId).toBe("6");
    });
  });
  test("빈 명단을 참여 업체 0명의 확정 사실로 내보내지 않는다", async () => {
    await withServer({ find: async () => ({ ...record, rows: [], sourceRosterSize: null }) }, async (server) => {
      const response = await request(server).get(path());
      expect(response.status).toBe(200);
      expect(response.body.state).toBe("not-observed");
      expect(response.body.rows).toEqual([]);
    });
  });
  test("잘못된 revision과 추가 query를 DB 조회 전에 거부한다", async () => {
    let calls = 0;
    await withServer({ find: async () => { calls++; return record; } }, async (server) => {
      for (const query of ["revisionId=0", "revisionId=01", "revisionId=9223372036854775808", "unexpected=1"]) {
        const response = await request(server).get(`${path()}?${query}`);
        expect(response.status).toBe(400);
      }
      expect(calls).toBe(0);
    });
  });
  test("없는 회차·연결 장애·명단 손실을 서로 다른 HTTP 실패로 내보내고 내부 원문은 숨긴다", async () => {
    for (const [reader, expectedStatus] of [
      [{ find: async () => null }, 404],
      [{ find: async () => { throw new Error("private connection failure"); } }, 503],
      [{ find: async () => { throw new AuctionRosterIntegrityError("private missing row"); } }, 500],
    ] as const) {
      await withServer(reader, async (server) => {
        const response = await request(server).get(path());
        expect(response.status).toBe(expectedStatus);
        expect(JSON.stringify(response.body)).not.toContain("private");
      });
    }
  });
});
