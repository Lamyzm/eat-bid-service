import { describe, expect, test } from "bun:test";
import { createUnitOfWork } from "../../../../platform/database/unit-of-work";
import { organizationId } from "../../domain/organization-id";
import { MAX_ROSTER_ROWS } from "../../domain/roster-limits";
import { DrizzleOwnBidReader } from "./drizzle-own-bid-reader";

const lineageRow = {
  build_id: "601", source_release_id: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f", calc_version: "mart-r1",
  computed_at: "2026-09-07T00:10:00Z", region_scheme: null, coverage: null,
};

/** 내 행이 없는 회차의 명단 근거 한 행이다. 명단 수만 바꿔 가며 상한 판정을 본다. */
function headerRow(rowCount: number) {
  return {
    auction_attempt_id: "5796468", auction_revision_id: "208",
    observation_id: "5052", normalized_record_id: "4817", content_sha256: "a".repeat(64), source_system: "eat",
    expected_count: rowCount, row_count: rowCount, ordinal_count: rowCount, foreign_observation_count: 0,
    observed_at: "2026-09-06T17:18:17.785575Z", observed_at_count: 1,
    submission_id: null, roster_ordinal: null, supplier_party_id: null, source_supplier_account_id: null,
    amount: null, effective_amount: null, currency: null, bid_rate: null, rank: null, submitted_at: null,
    status_id: null, status_code: null, status_scheme: null, status_label: null,
  };
}

async function readWithRoster(rowCount: number) {
  // 활성 build 조회가 먼저, 명단 조회가 다음이다. 스냅샷 handle은 UnitOfWork가 만든 것만 통과한다.
  const results = [[lineageRow], [headerRow(rowCount)]];
  const snapshot = createUnitOfWork({
    transaction: (work) => work({ execute: async () => results.shift() ?? [] }),
  });
  return snapshot.run((handle) => new DrizzleOwnBidReader().read(handle, {
    supplierPartyId: 30n,
    organizationId: organizationId(3101n),
    buildId: 601n,
    attempts: [{ attemptId: 5_796_468n, revisionId: 208n }],
  }));
}

describe("개인 투찰 조회의 명단 상한 경계", () => {
  test("명단 수가 상한과 같으면 읽을 수 있고 한 행이라도 넘으면 증거 불일치로 격리한다", async () => {
    const atLimit = await readWithRoster(MAX_ROSTER_ROWS);
    expect(atLimit.kind).toBe("observations");
    if (atLimit.kind !== "observations") return;
    expect(atLimit.attempts[0]?.result).toMatchObject({ kind: "absent-from-roster", rosterRowCount: MAX_ROSTER_ROWS });

    const overLimit = await readWithRoster(MAX_ROSTER_ROWS + 1);
    expect(overLimit.kind).toBe("observations");
    if (overLimit.kind !== "observations") return;
    expect(overLimit.attempts[0]?.result).toEqual({ kind: "evidence-conflict", reason: "roster-count-mismatch" });
  });
});
