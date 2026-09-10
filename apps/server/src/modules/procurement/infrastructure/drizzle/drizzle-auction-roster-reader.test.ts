import { describe, expect, test } from "bun:test";
import { DrizzleAuctionRosterReader } from "./drizzle-auction-roster-reader";
import { auctionId } from "../../domain/auction-id";
import { MAX_ROSTER_ROWS } from "../../domain/roster-limits";

const submissionRow = {
  auction_id: "5270", revision_id: "4708", expected_count: 1, source_roster_size: 2,
  observation_id: "5052", normalized_record_id: "4817", source_system: "eat",
  content_sha256: "a".repeat(64),
  observed_at: "2026-09-06T17:18:17.785575Z", observed_at_count: 1,
  submission_id: "9007199254740993", roster_ordinal: 0, supplier_party_id: "30",
  source_supplier_account_id: "40", supplier_name: "관측 업체",
  amount: "1000000000000.01", effective_amount: null, currency: "KRW", bid_rate: "100.001",
  rank: null, submitted_at: null,
  status_id: "50", status_code: "005", status_scheme: "eat:bid-status", status_label: "낙찰실패",
  withdrawal_id: null, withdrawal_code: null, withdrawal_scheme: null, withdrawal_label: null,
  awarded_roster_ordinal: null, awarded_amount: null, award_currency: null,
  awarded_rate: null, runner_up_rate: null,
};

describe("회차 명단 조회 경계", () => {
  test("존재하지 않는 회차는 미관측 빈 명단과 구분한다", async () => {
    const reader = new DrizzleAuctionRosterReader({ execute: async () => [] });
    expect(await reader.find({ auctionId: auctionId(5270n), revisionId: null })).toBeNull();
  });
  test("정규화 명단과 core 행 수가 다르면 일부를 성공으로 내보내지 않는다", async () => {
    const reader = new DrizzleAuctionRosterReader({ execute: async () => [{
      auction_id: "5270", revision_id: "4708", expected_count: 34,
      submission_id: null, source_roster_size: 34
    }] });
    expect(reader.find({ auctionId: auctionId(5270n), revisionId: null })).rejects.toThrow("명단");
  });
  test("업체 관측 라벨과 큰 식별자를 보존하고 별도 블록 참여 수의 차이는 허용한다", async () => {
    const reader = new DrizzleAuctionRosterReader({ execute: async () => [submissionRow] });
    const result = await reader.find({ auctionId: auctionId(5270n), revisionId: 4708n });
    expect(result?.rows).toHaveLength(1);
    expect(result?.sourceRosterSize).toBe(2);
    expect(result?.rows[0]?.submissionId).toBe(9007199254740993n);
    expect(result?.rows[0]?.supplierName).toBe("관측 업체");
    expect(result?.rows[0]?.rank).toBeNull();
    expect(result?.observedAt.toString()).toBe("2026-09-06T17:18:17.785575Z");
  });
  test("관측 시각 근거가 없거나 하나로 모이지 않으면 회차를 못 찾은 것과 구분한다", async () => {
    for (const evidence of [
      { observed_at: null, observed_at_count: 0 },
      { observed_at: null, observed_at_count: 2 },
    ]) {
      const reader = new DrizzleAuctionRosterReader({
        execute: async () => [{ ...submissionRow, ...evidence }],
      });
      const result = reader.find({ auctionId: auctionId(5270n), revisionId: null });
      await expect(result).rejects.toThrow("명단 관측 시각");
    }
  });
  test("명단 상한까지는 읽고 한 행이라도 넘으면 무결성 결함으로 격리한다", async () => {
    const rosterOf = (size: number) => Array.from({ length: size }, (_row, ordinal) => ({
      ...submissionRow, roster_ordinal: ordinal, expected_count: size, submission_id: String(1_000 + ordinal),
    }));
    const atLimit = new DrizzleAuctionRosterReader({ execute: async () => rosterOf(MAX_ROSTER_ROWS) });
    expect((await atLimit.find({ auctionId: auctionId(5270n), revisionId: null }))?.rows).toHaveLength(MAX_ROSTER_ROWS);
    const overLimit = new DrizzleAuctionRosterReader({ execute: async () => rosterOf(MAX_ROSTER_ROWS + 1) });
    await expect(overLimit.find({ auctionId: auctionId(5270n), revisionId: null })).rejects.toThrow("명단");
  });
  test("중복 명단 좌표와 명단 밖 낙찰 좌표는 성공 응답에서 격리한다", async () => {
    for (const rows of [
      [{ ...submissionRow, expected_count: 2 }, { ...submissionRow, expected_count: 2 }],
      [{ ...submissionRow, awarded_roster_ordinal: 4 }],
    ]) {
      const reader = new DrizzleAuctionRosterReader({ execute: async () => rows });
      await expect(reader.find({ auctionId: auctionId(5270n), revisionId: null })).rejects.toThrow("명단");
    }
  });
});
