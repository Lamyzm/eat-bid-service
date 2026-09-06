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
      "open_auction_snapshot_build_region_sido_idx",
      "open_auction_snapshot_build_item_label_idx",
    ]);
  });

  test("통화 없는 금액과 음수 참여 수를 막는다", () => {
    const checks = checkNames(openAuctionSnapshot);

    expect(checks).toContain("open_auction_snapshot_currency_required_with_amount");
    expect(checks).toContain("open_auction_snapshot_bid_count_nonnegative");
  });

  test("상세에서 온 하한율·지역·계보 열은 전부 null 허용이다", () => {
    const nullability = columnNullability(openAuctionSnapshot);

    expect(nullability.floor_rate).toBe(false);
    expect(nullability.region_sido_code_value_id).toBe(false);
    expect(nullability.region_sigungu_code_value_id).toBe(false);
    expect(nullability.organization_label).toBe(false);
    expect(nullability.terms_revision_id).toBe(false);
  });

  test("지역 축은 code value를 가리키고 계보는 revision을 가리킨다", () => {
    const foreignKeys = foreignKeyColumnSets(openAuctionSnapshot);

    expect(foreignKeys).toContainEqual({
      columns: ["region_sido_code_value_id"],
      foreignTable: "code_value",
    });
    expect(foreignKeys).toContainEqual({
      columns: ["region_sigungu_code_value_id"],
      foreignTable: "code_value",
    });
    expect(foreignKeys).toContainEqual({
      columns: ["terms_revision_id"],
      foreignTable: "auction_revision",
    });
  });

  test("상세에서 온 값이 있으면 어느 revision에서 왔는지도 있어야 한다", () => {
    expect(checkNames(openAuctionSnapshot)).toContain("open_auction_snapshot_terms_lineage_required");
  });
});
