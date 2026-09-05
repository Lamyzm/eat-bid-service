import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { openAuctionSnapshot } from "./open-auction-snapshot";
import {
  checkNames,
  columnNames,
  columnNullability,
  foreignKeyColumnSets,
  indexNames,
  nullsNotDistinctUniqueColumnSets,
} from "./table-config.fixture";

describe("mart.open_auction_snapshot 스키마", () => {
  test("관측 시각까지가 grain이고 첫 열이 build 계보다", () => {
    const config = getTableConfig(openAuctionSnapshot);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("open_auction_snapshot");
    expect(columnNames(openAuctionSnapshot)[0]).toBe("build_id");
    expect(nullsNotDistinctUniqueColumnSets(openAuctionSnapshot)).toEqual([
      ["build_id", "auction_attempt_id", "observed_at"],
    ]);
  });

  test("스냅샷 행은 근거 관측 없이 만들어지지 않는다", () => {
    expect(columnNullability(openAuctionSnapshot).observation_id).toBe(true);
    expect(foreignKeyColumnSets(openAuctionSnapshot)).toContainEqual({
      columns: ["observation_id"],
      foreignTable: "raw_observation",
    });
  });

  test("참여 수 추이는 활성 build 하나를 넘어 읽으므로 attempt 축 인덱스를 따로 둔다", () => {
    expect(indexNames(openAuctionSnapshot)).toEqual([
      "open_auction_snapshot_build_closes_idx",
      "open_auction_snapshot_attempt_observed_idx",
    ]);
  });

  test("통화 없는 금액과 음수 참여 수를 막는다", () => {
    const checks = checkNames(openAuctionSnapshot);

    expect(checks).toContain("open_auction_snapshot_currency_required_with_amount");
    expect(checks).toContain("open_auction_snapshot_bid_count_nonnegative");
  });
});
