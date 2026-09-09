import { describe, expect, test } from "bun:test";
import { auctionRosterV1ResponseSchema } from "./get-auction-roster.response";
import { auctionV1Operations } from "./operations";

export const rosterFixture = () => ({
  auctionId: "5270", revisionId: "4708", state: "observed",
  rows: [{
    submissionId: "9007199254740993", rosterOrdinal: 0,
    supplier: { supplierPartyId: "10", sourceSupplierAccountId: "20", name: "검증 업체" },
    sourceCalculatedAmount: { amount: "1000000000000.01", currency: "KRW" }, submittedAmount: null,
    bidRate: { value: "100.001", unit: "percentage-points" },
    rank: 2, submittedAt: null,
    sourceStatus: { codeValueId: "30", code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
    withdrawal: null
  }],
  award: null,
  meta: {
    rowCount: 1, sourceRosterSize: 2, observedAt: "2026-09-06T17:18:17.785575Z",
    provenance: { sourceSystem: "eat", observationId: "5052", normalizedRecordId: "4817", contentSha256: "a".repeat(64) }
  }
});

describe("회차 참여 명단 공개 계약", () => {
  test("큰 식별자와 금액 및 100을 넘는 관측 비율을 손실 없이 보존한다", () => {
    const data = rosterFixture();
    expect(auctionRosterV1ResponseSchema.parse(data)).toEqual(data);
  });
  test("관측 명단 크기와 응답 행 수를 서로 채워 넣지 않는다", () => {
    const parsed = auctionRosterV1ResponseSchema.parse(rosterFixture());
    expect(parsed.meta.sourceRosterSize).toBe(2);
    expect(parsed.meta.rowCount).toBe(1);
  });
  test("원본보다 긴 소수와 숫자로 바뀐 식별자를 거부한다", () => {
    const data = rosterFixture();
    expect(auctionRosterV1ResponseSchema.safeParse({ ...data, auctionId: 5270 }).success).toBe(false);
    data.rows[0]!.bidRate.value = "88.0001";
    expect(auctionRosterV1ResponseSchema.safeParse(data).success).toBe(false);
  });
  test("회차와 revision 경로를 operation 하나에서 파생한다", () => {
    const operation = auctionV1Operations.roster;
    expect(operation.buildPath({ path: { auctionId: "5270" }, query: {} })).toBe("/api/v1/auctions/5270/roster");
    expect(operation.querySchema.safeParse({ revisionId: "0" }).success).toBe(false);
  });
});
