import { describe, expect, test } from "bun:test";
import { sourceSupplierAccount, supplierParty } from "./index";
import {
  columnNames,
  columnNullability,
  columns,
  foreignKeyColumnSets,
  uniqueColumnSets,
} from "./table-config.fixture";

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

  test("소스 계정은 계정과 업체의 짝으로 유일해 한 계정이 시점에 따라 다른 업체로 관측된다", () => {
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
    // 계정 code value 단독 unique는 "이 계정은 영원히 한 업체"라는 거짓 주장이었다. 계정 200075가
    // 사업자번호를 바꾸자 그 주장이 참인 관측 16,915건을 두 번 버렸다(ADR 0049).
    expect(uniqueColumnSets(sourceSupplierAccount)).not.toContainEqual(["account_code_value_id"]);
    expect(uniqueColumnSets(sourceSupplierAccount)).toContainEqual([
      "account_code_value_id",
      "supplier_party_id",
    ]);
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
