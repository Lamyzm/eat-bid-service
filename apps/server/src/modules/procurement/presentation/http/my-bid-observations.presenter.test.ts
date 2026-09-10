import { describe, expect, test } from "bun:test";
import { myBidObservationsV1ResponseSchema } from "@eatbid/contracts";
import { canonicalDecimal, krw, observedBidRate, Temporal } from "@eatbid/domain";
import type { MyBidObservationsRecord } from "../../application/find-my-bid-observations";
import type { OwnBidAttemptRecord, OwnBidProvenanceRecord } from "../../application/own-bid-reader";
import { organizationId } from "../../domain/organization-id";
import { toAttemptObservation, toMyBidObservationsResponse } from "./my-bid-observations.presenter";

const provenance: OwnBidProvenanceRecord = {
  sourceSystem: "eat", observationId: 5052n, normalizedRecordId: 4817n, contentSha256: "a".repeat(64),
};
const observedAt = Temporal.Instant.from("2026-09-06T17:18:17.785575Z");

const submitted: OwnBidAttemptRecord = {
  attemptId: 5_796_468n,
  revisionId: 208n,
  result: {
    kind: "submitted",
    rows: [{
      submissionId: 9_007_199_254_740_993n,
      rosterOrdinal: 3,
      supplierPartyId: 30n,
      sourceSupplierAccountId: 40n,
      sourceCalculatedAmount: krw(canonicalDecimal("1000000000000.01", 2)),
      submittedAmount: null,
      bidRate: observedBidRate(canonicalDecimal("100.001", 3)),
      rank: 2,
      submittedAt: Temporal.Instant.from("2026-09-05T03:00:00Z"),
      sourceStatus: { codeValueId: 50n, code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
    }],
    rosterRowCount: 17,
    observedAt,
    provenance,
  },
};

const record: MyBidObservationsRecord = {
  registeredBusinessId: 77n,
  organizationId: organizationId(3101n),
  supplier: { kind: "observed", supplierPartyId: 30n, attempts: [submitted] },
  lineage: {
    buildId: 601n,
    sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
    calcVersion: "mart-r1",
    computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
    coverage: null,
    regionScheme: null,
  },
};

describe("내 투찰 관측 presenter", () => {
  test("회차별 네 가지 결과를 이름 있는 상태로 직렬화하고 세지 않은 명단 수를 0으로 싣지 않는다", () => {
    expect(toAttemptObservation(submitted)).toEqual({
      attemptId: "5796468",
      revisionId: "208",
      result: {
        kind: "submitted",
        rows: [{
          submissionId: "9007199254740993",
          rosterOrdinal: 3,
          supplierPartyId: "30",
          sourceSupplierAccountId: "40",
          sourceCalculatedAmount: { amount: "1000000000000.01", currency: "KRW" },
          submittedAmount: null,
          bidRate: { value: "100.001", unit: "percentage-points" },
          rank: 2,
          submittedAt: "2026-09-05T03:00:00Z",
          sourceStatus: { codeValueId: "50", code: "005", scheme: "eat:bid-status", label: "낙찰실패" },
        }],
        rosterRowCount: 17,
        observedAt: "2026-09-06T17:18:17.785575Z",
        provenance: { sourceSystem: "eat", observationId: "5052", normalizedRecordId: "4817", contentSha256: "a".repeat(64) },
      },
    });
    const wireProvenance = { sourceSystem: "eat", observationId: "5052", normalizedRecordId: "4817", contentSha256: "a".repeat(64) };
    expect(toAttemptObservation({ ...submitted, result: { kind: "absent-from-roster", rosterRowCount: 17, observedAt, provenance } }).result)
      .toEqual({ kind: "absent-from-roster", rosterRowCount: 17, observedAt: "2026-09-06T17:18:17.785575Z", provenance: wireProvenance });
    expect(toAttemptObservation({ ...submitted, result: { kind: "roster-not-observed", provenance } }).result)
      .toEqual({ kind: "roster-not-observed", provenance: wireProvenance });
    expect(toAttemptObservation({ ...submitted, result: { kind: "evidence-conflict", reason: "roster-count-mismatch" } }).result)
      .toEqual({ kind: "evidence-conflict", reason: "roster-count-mismatch" });
  });

  test("대조된 party가 있을 때만 회차 목록 자리를 만들고 meta는 읽은 build의 계보를 싣는다", () => {
    const response = toMyBidObservationsResponse(record);
    expect(myBidObservationsV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.businessId).toBe("77");
    expect(response.organizationId).toBe("3101");
    expect(response.supplier).toMatchObject({ kind: "observed", supplierPartyId: "30" });
    expect(response.supplier.kind === "observed" ? response.supplier.attempts : []).toHaveLength(1);
    expect(response.meta).toEqual({
      buildId: "601",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r1",
      computedAt: "2026-09-07T00:10:00Z",
      coverage: null,
      regionScheme: null,
    });
    // 미관측과 증거 불일치는 빈 목록이 아니라 이름 있는 상태다(ADR 0032 §7).
    for (const kind of ["unobserved", "evidence-conflict"] as const) {
      const unlinked = toMyBidObservationsResponse({ ...record, supplier: { kind } });
      expect(myBidObservationsV1ResponseSchema.parse(unlinked)).toEqual(unlinked);
      expect(unlinked.supplier).toEqual({ kind });
    }
  });
});
