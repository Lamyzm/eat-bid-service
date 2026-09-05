import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auctionRevision, bidSubmission, sourceSupplierAccount, supplierParty } from "./index";

const coreRoot = fileURLToPath(new URL("./", import.meta.url));

const readCoreModule = (file: string) => readFile(path.join(coreRoot, file), "utf8");

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns;

const columnNames = (table: Parameters<typeof getTableConfig>[0]) => columns(table).map((column) => column.name);

const columnNullability = (table: Parameters<typeof getTableConfig>[0]) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.notNull]));

const uniqueColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name));

const nullsNotDistinctUniqueColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).uniqueConstraints
    .filter((constraint) => constraint.nullsNotDistinct)
    .map((constraint) => constraint.columns.map((column) => column.name));

const columnSqlTypes = (table: Parameters<typeof getTableConfig>[0]) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.getSQLType()]));

// 우리가 계산한 실효하한이나 승패를 관측 자리에 앉히지 못하게 막는 금지 어간이다(ADR 0033 §4-가).
const forbiddenDerivedColumnStems = ["won", "invalid", "floor"] as const;

const foreignKeyColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: reference.foreignTable[Symbol.for("drizzle:Name")],
    };
  });

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

describe("참여 업체 identity 불변식", () => {
  test("업체 정체성은 사업자번호 code value로만 유일하다", () => {
    const names = columnNames(supplierParty);

    expect(names).toEqual([
      "supplier_party_id",
      "type",
      "canonical_name",
      "business_number_code_value_id",
      "created_at",
    ]);
    expect(columnNullability(supplierParty)).toEqual({
      supplier_party_id: true,
      type: true,
      canonical_name: false,
      business_number_code_value_id: false,
      created_at: true,
    });
    expect(uniqueColumnSets(supplierParty)).toContainEqual(["business_number_code_value_id"]);
    expect(uniqueColumnSets(supplierParty)).not.toContainEqual(["canonical_name"]);
    expect(foreignKeyColumnSets(supplierParty)).toEqual([
      { columns: ["business_number_code_value_id"], foreignTable: "code_value" },
    ]);
  });

  test("업체명과 사업자번호 문자열을 정체성 열로 승격하지 않는다", () => {
    const names = columnNames(supplierParty);

    expect(names).not.toContain("business_number");
    expect(names).not.toContain("code");
    expect(names).not.toContain("code_scheme_id");
  });

  test("소스 계정은 계정 code value로 유일하고 한 업체에 여러 계정이 붙는다", () => {
    expect(columnNames(sourceSupplierAccount)).toEqual([
      "source_supplier_account_id",
      "supplier_party_id",
      "source_system",
      "account_code_value_id",
      "observation_id",
    ]);
    expect(columnNullability(sourceSupplierAccount)).toEqual({
      source_supplier_account_id: true,
      supplier_party_id: true,
      source_system: true,
      account_code_value_id: true,
      observation_id: true,
    });
    expect(uniqueColumnSets(sourceSupplierAccount)).toContainEqual(["account_code_value_id"]);
    expect(uniqueColumnSets(sourceSupplierAccount)).not.toContainEqual(["supplier_party_id"]);
    expect(foreignKeyColumnSets(sourceSupplierAccount)).toEqual(expect.arrayContaining([
      { columns: ["supplier_party_id"], foreignTable: "supplier_party" },
      { columns: ["account_code_value_id"], foreignTable: "code_value" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("계정과 업체의 짝을 복합 FK 대상 unique로 고정한다", () => {
    expect(uniqueColumnSets(sourceSupplierAccount)).toContainEqual([
      "source_supplier_account_id",
      "supplier_party_id",
    ]);
  });

  test("업체 table의 모든 bigint 열은 bigint int64 mapping을 선언한다", () => {
    for (const table of [supplierParty, sourceSupplierAccount]) {
      for (const column of columns(table).filter((candidate) => candidate.getSQLType() === "bigint")) {
        expect(column.dataType, `${column.name} must declare bigint int64`).toBe("bigint int64");
        expect(column.columnType, `${column.name} must use PgBigInt64`).toBe("PgBigInt64");
      }
    }
  });

  test("업체 table은 generated bigint primary key를 사용한다", () => {
    for (const [table, primaryKey] of [
      [supplierParty, "supplier_party_id"],
      [sourceSupplierAccount, "source_supplier_account_id"],
    ] as const) {
      const column = columns(table).find((candidate) => candidate.name === primaryKey);

      expect(column?.primary).toBe(true);
      expect(column?.getSQLType()).toBe("bigint");
      expect(column?.generatedIdentity).toEqual({ type: "always" });
    }
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

  test("계산된 하한이나 승패 열을 두지 않는다", () => {
    for (const name of columnNames(bidSubmission)) {
      for (const stem of forbiddenDerivedColumnStems) {
        expect(name.split("_")).not.toContain(stem);
      }
    }
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
