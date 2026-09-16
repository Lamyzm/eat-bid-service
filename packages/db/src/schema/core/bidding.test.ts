import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auctionAttemptLink, auctionRevision, awardDecision, bidSubmission } from "./index";
import {
  checkNames,
  columnNames,
  columnNullability,
  columnSqlTypes,
  columns,
  expectNoDerivedVerdictColumns,
  foreignKeyColumnSets,
  nullsNotDistinctUniqueColumnSets,
  uniqueColumnSets,
} from "./table-config.fixture";

const coreRoot = fileURLToPath(new URL("./", import.meta.url));

const readCoreModule = (file: string) => readFile(path.join(coreRoot, file), "utf8");

const biddingTableNames = [
  "supplier_party",
  "source_supplier_account",
  "bid_submission",
  "award_decision",
  "auction_attempt_link",
];

describe("투찰·공급자 table 경계", () => {
  test("투찰·공급자 table을 공고 module에 되돌려 놓지 않는다", async () => {
    const procurement = await readCoreModule("procurement.ts");

    for (const tableName of biddingTableNames) {
      expect(procurement).not.toContain(`"${tableName}"`);
    }
  });

  test("공급자·투찰 module은 core schema barrel에서 함께 공개한다", async () => {
    const coreIndex = await readCoreModule("index.ts");

    expect(coreIndex).toContain('export * from "./suppliers.js";');
    expect(coreIndex).toContain('export * from "./bidding.js";');
  });
});

describe("명단 행(bid_submission) 계약", () => {
  test("명단 행의 발행 grain은 revision과 관측 행 순서다", () => {
    expect(nullsNotDistinctUniqueColumnSets(bidSubmission)).toContainEqual([
      "auction_revision_id",
      "roster_ordinal",
      "opened_at",
    ]);
    expect(nullsNotDistinctUniqueColumnSets(bidSubmission)).toContainEqual([
      "bid_submission_id",
      "opened_at",
    ]);
  });

  test("파티션 키가 nullable이라 명단 행에 primary key를 두지 않는다", () => {
    expect(columns(bidSubmission).some((column) => column.primary)).toBe(false);
    expect(getTableConfig(bidSubmission).primaryKeys).toEqual([]);
    expect(columnNullability(bidSubmission).opened_at).toBe(false);
  });

  test("사정률은 정수부 12자리를 잃지 않는다", () => {
    expect(columnSqlTypes(bidSubmission).bid_rate).toBe("numeric(15, 3)");
    expect(columnSqlTypes(bidSubmission).amount).toBe("numeric(18, 2)");
    expect(columnSqlTypes(bidSubmission).effective_amount).toBe("numeric(18, 2)");
  });

  test("명단 행의 열과 nullability를 원본 관측 그대로 고정한다", () => {
    expect(columnNames(bidSubmission)).toEqual([
      "bid_submission_id",
      "auction_revision_id",
      "auction_attempt_id",
      "opened_at",
      "roster_ordinal",
      "source_supplier_account_id",
      "supplier_party_id",
      "submitted_at",
      "amount",
      "effective_amount",
      "currency",
      "bid_rate",
      "rank",
      "source_status_code_value_id",
      "withdrawal_code_value_id",
      "draw_numbers",
      "observed_roster_size",
      "observation_id",
    ]);
    expect(columnNullability(bidSubmission)).toEqual({
      bid_submission_id: true,
      auction_revision_id: true,
      auction_attempt_id: true,
      opened_at: false,
      roster_ordinal: true,
      source_supplier_account_id: true,
      supplier_party_id: true,
      submitted_at: false,
      amount: true,
      effective_amount: false,
      currency: true,
      bid_rate: true,
      rank: false,
      source_status_code_value_id: true,
      withdrawal_code_value_id: false,
      draw_numbers: true,
      observed_roster_size: false,
      observation_id: true,
    });
  });

  test("명단 행은 revision의 attempt와 계정의 업체를 복합 FK로 고정한다", () => {
    expect(foreignKeyColumnSets(bidSubmission)).toEqual(expect.arrayContaining([
      {
        columns: ["auction_revision_id", "auction_attempt_id"],
        foreignTable: "auction_revision",
      },
      {
        columns: ["source_supplier_account_id", "supplier_party_id"],
        foreignTable: "source_supplier_account",
      },
      { columns: ["source_status_code_value_id"], foreignTable: "code_value" },
      { columns: ["withdrawal_code_value_id"], foreignTable: "code_value" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("revision은 복합 FK 대상이 될 attempt 짝 unique를 갖는다", () => {
    expect(uniqueColumnSets(auctionRevision)).toContainEqual([
      "auction_revision_id",
      "auction_attempt_id",
    ]);
  });

  test("명단 table의 모든 bigint 열은 bigint int64 mapping을 선언한다", () => {
    for (const column of columns(bidSubmission).filter((candidate) => candidate.getSQLType() === "bigint")) {
      expect(column.dataType, `${column.name} must declare bigint int64`).toBe("bigint int64");
      expect(column.columnType, `${column.name} must use PgBigInt64`).toBe("PgBigInt64");
    }
  });
});

describe("낙찰 판정(award_decision) 계약", () => {
  test("한 revision에 낙찰 판정은 하나뿐이다", () => {
    expect(uniqueColumnSets(awardDecision)).toContainEqual(["auction_revision_id"]);
    expect(columnNullability(awardDecision).auction_revision_id).toBe(true);
  });

  test("낙찰 행은 명단 행을 FK로 가리키지 않는다", () => {
    const references = foreignKeyColumnSets(awardDecision);

    expect(references.map((reference) => reference.foreignTable)).not.toContain("bid_submission");
    expect(columnNames(awardDecision)).toContain("awarded_roster_ordinal");
    expect(columnNames(awardDecision)).not.toContain("bid_submission_id");
  });

  test("낙찰 행의 열과 nullability를 원본 관측 그대로 고정한다", () => {
    expect(columnNames(awardDecision)).toEqual([
      "award_decision_id",
      "auction_revision_id",
      "auction_attempt_id",
      "awarded_roster_ordinal",
      "source_supplier_account_id",
      "supplier_party_id",
      "awarded_at",
      "awarded_amount",
      "currency",
      "awarded_rate",
      "runner_up_rate",
      "source_status_code_value_id",
      "observation_id",
    ]);
    expect(columnNullability(awardDecision)).toEqual({
      award_decision_id: true,
      auction_revision_id: true,
      auction_attempt_id: true,
      awarded_roster_ordinal: true,
      source_supplier_account_id: true,
      supplier_party_id: true,
      awarded_at: false,
      awarded_amount: true,
      currency: true,
      awarded_rate: true,
      runner_up_rate: false,
      source_status_code_value_id: true,
      observation_id: true,
    });
    expect(columnSqlTypes(awardDecision).awarded_rate).toBe("numeric(15, 3)");
    expect(columnSqlTypes(awardDecision).runner_up_rate).toBe("numeric(15, 3)");
  });

  test("낙찰 table도 generated bigint primary key와 복합 FK를 쓴다", () => {
    const primaryKeyColumn = columns(awardDecision).find(
      (column) => column.name === "award_decision_id",
    );

    expect(primaryKeyColumn?.primary).toBe(true);
    expect(primaryKeyColumn?.generatedIdentity).toEqual({ type: "always" });
    expect(foreignKeyColumnSets(awardDecision)).toEqual(expect.arrayContaining([
      {
        columns: ["auction_revision_id", "auction_attempt_id"],
        foreignTable: "auction_revision",
      },
      {
        columns: ["source_supplier_account_id", "supplier_party_id"],
        foreignTable: "source_supplier_account",
      },
      { columns: ["source_status_code_value_id"], foreignTable: "code_value" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });
});

describe("재입찰 사슬(auction_attempt_link) 계약", () => {
  test("재입찰 사슬은 내부 attempt id로만 잇는다", () => {
    const names = columnNames(auctionAttemptLink);

    expect(names).toContain("from_auction_attempt_id");
    expect(names).toContain("to_auction_attempt_id");
    expect(names).not.toContain("external_bid_id");
    expect(names).not.toContain("to_external_bid_id");
    expect(foreignKeyColumnSets(auctionAttemptLink)).toEqual(expect.arrayContaining([
      { columns: ["from_auction_attempt_id"], foreignTable: "auction_attempt" },
      { columns: ["to_auction_attempt_id"], foreignTable: "auction_attempt" },
    ]));
  });

  test("표시 입찰 번호를 관계 키로 쓰지 않는다", () => {
    expect(columnNullability(auctionAttemptLink).display_bid_no).toBe(false);
    for (const columnSet of uniqueColumnSets(auctionAttemptLink)) {
      expect(columnSet).not.toContain("display_bid_no");
    }
  });

  test("한 revision이 관측한 사슬 관계를 상대와 관계 종류로 유일하게 둔다", () => {
    expect(uniqueColumnSets(auctionAttemptLink)).toContainEqual([
      "auction_revision_id",
      "to_auction_attempt_id",
      "relation",
    ]);
  });

  test("사슬 관계 종류와 금액 통화를 named check로 고정한다", () => {
    expect(checkNames(auctionAttemptLink)).toEqual([
      "auction_attempt_link_relation_allowed",
      "auction_attempt_link_currency_required_with_amount",
      "auction_attempt_link_planned_amount_positive",
    ]);
  });

  test("사슬 table의 열과 nullability를 관측 그대로 고정한다", () => {
    expect(columnNames(auctionAttemptLink)).toEqual([
      "auction_attempt_link_id",
      "auction_revision_id",
      "from_auction_attempt_id",
      "to_auction_attempt_id",
      "relation",
      "display_bid_no",
      "source_status_code_value_id",
      "bid_opened_from",
      "bid_closed_at",
      "base_amount",
      "planned_amount",
      "currency",
      "observation_id",
    ]);
    expect(columnNullability(auctionAttemptLink)).toEqual({
      auction_attempt_link_id: true,
      auction_revision_id: true,
      from_auction_attempt_id: true,
      to_auction_attempt_id: true,
      relation: true,
      display_bid_no: false,
      source_status_code_value_id: false,
      bid_opened_from: false,
      bid_closed_at: false,
      base_amount: false,
      planned_amount: false,
      currency: false,
      observation_id: true,
    });
  });
});

describe("원본 판정 권위", () => {
  test("계산된 하한이나 승패 열을 두지 않는다", () => {
    for (const table of [bidSubmission, awardDecision, auctionAttemptLink]) {
      expect(expectNoDerivedVerdictColumns(table)).toEqual([]);
    }
  });
});
