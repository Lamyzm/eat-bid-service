import { describe, expect, test } from "bun:test";
import { auctionRosterV1ResponseSchema } from "@eatbid/contracts";
import { canonicalDecimal, krw, observedBidRate, Temporal } from "@eatbid/domain";
import type { AuctionRosterRecord } from "../../application/auction-roster-reader";
import { auctionId } from "../../domain/auction-id";
import { toAuctionRosterResponse } from "./auction-roster.presenter";

const record: AuctionRosterRecord = {
  auctionId: auctionId(9_007_199_254_740_993n),
  revisionId: 99n,
  rows: [{
    submissionId: 9_007_199_254_740_994n,
    rosterOrdinal: 0,
    supplierPartyId: 3n,
    sourceSupplierAccountId: 4n,
    supplierName: "검증 업체",
    amount: krw(canonicalDecimal("1000000000000.01", 2)),
    effectiveAmount: null,
    bidRate: observedBidRate(canonicalDecimal("100.001", 3)),
    rank: null,
    submittedAt: Temporal.Instant.from("2026-09-06T17:00:00Z"),
    sourceStatus: { codeValueId: 5n, code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
    withdrawal: null,
  }],
  sourceRosterSize: 2,
  observedAt: Temporal.Instant.from("2026-09-06T17:18:17.785575Z"),
  provenance: { sourceSystem: "eat", observationId: 6n, normalizedRecordId: 7n, contentSha256: "a".repeat(64) },
  award: {
    rosterOrdinal: 0,
    amount: krw(canonicalDecimal("1000000000000.01", 2)),
    bidRate: observedBidRate(canonicalDecimal("100.001", 3)),
    secondRate: null,
  },
};

describe("회차 명단 presenter", () => {
  test("큰 식별자·정확한 금액·관측률을 손실 없이 직렬화하고 명단 수와 원천 명단 크기를 구분한다", () => {
    const response = toAuctionRosterResponse(record);
    expect(auctionRosterV1ResponseSchema.parse(response)).toEqual(response);
    expect(response).toEqual({
      auctionId: "9007199254740993",
      revisionId: "99",
      state: "observed",
      rows: [{
        submissionId: "9007199254740994",
        rosterOrdinal: 0,
        supplier: { supplierPartyId: "3", sourceSupplierAccountId: "4", name: "검증 업체" },
        sourceCalculatedAmount: { amount: "1000000000000.01", currency: "KRW" },
        submittedAmount: null,
        bidRate: { value: "100.001", unit: "percentage-points" },
        rank: null,
        submittedAt: "2026-09-06T17:00:00Z",
        sourceStatus: { codeValueId: "5", code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
        withdrawal: null,
      }],
      award: {
        rosterOrdinal: 0,
        sourceCalculatedAmount: { amount: "1000000000000.01", currency: "KRW" },
        bidRate: { value: "100.001", unit: "percentage-points" },
        secondRate: null,
      },
      meta: {
        rowCount: 1,
        sourceRosterSize: 2,
        observedAt: "2026-09-06T17:18:17.785575Z",
        provenance: { sourceSystem: "eat", observationId: "6", normalizedRecordId: "7", contentSha256: "a".repeat(64) },
      },
    });
  });

  test("빈 명단은 참여 업체 0명의 확정 사실이 아니라 미관측 상태로 내보낸다", () => {
    const response = toAuctionRosterResponse({ ...record, rows: [], sourceRosterSize: null, award: null });
    expect(auctionRosterV1ResponseSchema.parse(response)).toEqual(response);
    expect(response).toMatchObject({ state: "not-observed", rows: [], award: null, meta: { rowCount: 0, sourceRosterSize: null } });
  });
});
