import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  auctionAttempt,
  auctionOrganization,
  auctionRevision,
  auctionRevisionCodeValue,
  bidSubmission,
  codeLabelObservation,
  codeMapping,
  codeScheme,
  codeValue,
  organization,
  organizationIdentifier,
} from "./index";

// generated bigint primary key 규칙의 예외다. nullable 파티션 키 `opened_at`은 primary key에 들어갈 수
// 없고, primary key를 얻자고 not null로 좁히면 개찰 시각을 관측하지 못한 명단 전체를 격리하게 된다
// (ADR 0033 §3). 예외를 문장이 아니라 목록으로 두고 그 크기를 아래 테스트가 고정한다.
const partitionedFactTablesWithoutPrimaryKey = [bidSubmission] as const;

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns;

const columnNames = (table: Parameters<typeof getTableConfig>[0]) => columns(table).map((column) => column.name);

const columnNullability = (table: Parameters<typeof getTableConfig>[0]) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.notNull]));

const uniqueColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name));

const foreignKeyColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: reference.foreignTable[Symbol.for("drizzle:Name")],
    };
  });

describe("canonical identity 불변식", () => {
  test("모든 canonical bigint 열은 bigint TypeScript mapping을 선언한다", () => {
    for (const table of [
      codeScheme,
      codeValue,
      codeLabelObservation,
      codeMapping,
      organization,
      organizationIdentifier,
      auctionAttempt,
      auctionRevision,
      auctionOrganization,
      auctionRevisionCodeValue,
    ]) {
      for (const column of columns(table).filter((candidate) => candidate.getSQLType() === "bigint")) {
        expect(column.dataType, `${column.name} must declare bigint int64`).toBe("bigint int64");
        expect(column.columnType, `${column.name} must use PgBigInt64`).toBe("PgBigInt64");
      }
    }
  });

  test("독립 identity가 있는 모든 fact에 generated bigint primary key를 사용한다", () => {
    for (const [table, primaryKey] of [
      [codeScheme, "code_scheme_id"],
      [codeValue, "code_value_id"],
      [codeLabelObservation, "code_label_observation_id"],
      [codeMapping, "code_mapping_id"],
      [organization, "organization_id"],
      [organizationIdentifier, "organization_identifier_id"],
      [auctionAttempt, "auction_attempt_id"],
      [auctionRevision, "auction_revision_id"],
    ] as const) {
      const column = columns(table).find((candidate) => candidate.name === primaryKey);
      expect(column?.primary).toBe(true);
      expect(column?.getSQLType()).toBe("bigint");
      expect(column?.generatedIdentity).toEqual({ type: "always" });
    }

    expect(columns(auctionOrganization).every((column) => column.generatedIdentity === undefined)).toBe(true);
    expect(columns(auctionRevisionCodeValue).every((column) => column.generatedIdentity === undefined)).toBe(true);
  });

  test("primary key 없는 fact는 파티션 table 하나뿐이고 unique nulls not distinct로 대신한다", () => {
    expect(partitionedFactTablesWithoutPrimaryKey.length).toBe(1);

    for (const table of partitionedFactTablesWithoutPrimaryKey) {
      const config = getTableConfig(table);

      expect(config.primaryKeys).toEqual([]);
      expect(columns(table).some((column) => column.primary)).toBe(false);
      expect(config.uniqueConstraints.filter((constraint) => constraint.nullsNotDistinct).length).toBe(2);
    }

    const partitionedTableNames = new Set(
      partitionedFactTablesWithoutPrimaryKey.map((table) => getTableConfig(table).name),
    );
    for (const table of [
      codeScheme,
      codeValue,
      codeLabelObservation,
      codeMapping,
      organization,
      organizationIdentifier,
      auctionAttempt,
      auctionRevision,
    ]) {
      expect(partitionedTableNames.has(getTableConfig(table).name)).toBe(false);
    }
  });

  test("code source evidence를 고유 scheme 안의 text로 보존한다", () => {
    const code = columns(codeValue).find((column) => column.name === "code");

    expect(code?.getSQLType()).toBe("text");
    expect(uniqueColumnSets(codeScheme)).toContainEqual(["namespace"]);
    expect(uniqueColumnSets(codeValue)).toContainEqual(["code_scheme_id", "code"]);
  });

  test("code registry table을 관측 evidence와 명시된 grain으로 유지한다", () => {
    expect(columnNames(codeScheme)).toEqual(expect.arrayContaining([
      "code_scheme_id",
      "namespace",
      "owner",
      "version_policy",
      "valid_time_policy",
    ]));
    expect(columnNames(codeValue)).toEqual(expect.arrayContaining([
      "code_value_id",
      "code_scheme_id",
      "code",
      "valid_from",
      "valid_to",
      "active",
    ]));
    expect(columnNames(codeLabelObservation)).toEqual(expect.arrayContaining([
      "code_label_observation_id",
      "code_value_id",
      "label",
      "language",
      "observed_at",
      "observation_id",
    ]));
    expect(columnNames(codeMapping)).toEqual(expect.arrayContaining([
      "code_mapping_id",
      "from_code_value_id",
      "to_code_value_id",
      "relation",
      "valid_from",
      "valid_to",
      "evidence_observation_id",
      "status",
    ]));

    expect(foreignKeyColumnSets(codeValue)).toContainEqual({
      columns: ["code_scheme_id"],
      foreignTable: "code_scheme",
    });
    expect(foreignKeyColumnSets(codeLabelObservation)).toEqual(expect.arrayContaining([
      { columns: ["code_value_id"], foreignTable: "code_value" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
    expect(foreignKeyColumnSets(codeMapping)).toEqual(expect.arrayContaining([
      { columns: ["from_code_value_id"], foreignTable: "code_value" },
      { columns: ["to_code_value_id"], foreignTable: "code_value" },
      { columns: ["evidence_observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("organization identity에는 단일 code-value authority만 사용한다", () => {
    const identifierColumns = columnNames(organizationIdentifier);

    expect(identifierColumns).toEqual(expect.arrayContaining([
      "organization_identifier_id",
      "organization_id",
      "code_value_id",
      "observation_id",
    ]));
    expect(identifierColumns).not.toContain("code_scheme_id");
    expect(identifierColumns).not.toContain("code");
    expect(uniqueColumnSets(organizationIdentifier)).toContainEqual(["code_value_id"]);
    expect(foreignKeyColumnSets(organizationIdentifier)).toEqual(expect.arrayContaining([
      { columns: ["organization_id"], foreignTable: "organization" },
      { columns: ["code_value_id"], foreignTable: "code_value" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("organization 이름과 표시 입찰 번호를 identity로 승격하지 않는다", () => {
    expect(uniqueColumnSets(organization)).not.toContainEqual(["canonical_name"]);
    expect(columnNames(auctionAttempt)).not.toContain("display_bid_no");
    expect(columnNullability(organization).canonical_name).toBe(false);
    expect(columnNullability(auctionRevision).display_bid_no).toBe(false);
  });

  test("auction identity는 source에, revision은 normalized interpretation에 범위를 둔다", () => {
    expect(uniqueColumnSets(auctionAttempt)).toContainEqual(["source_system", "external_bid_id"]);
    expect(uniqueColumnSets(auctionRevision)).toContainEqual(["normalized_record_id"]);
    expect(uniqueColumnSets(auctionRevision)).not.toContainEqual(["auction_attempt_id", "content_sha256"]);
    expect(foreignKeyColumnSets(auctionRevision)).toEqual(expect.arrayContaining([
      { columns: ["auction_attempt_id"], foreignTable: "auction_attempt" },
      { columns: ["normalized_record_id"], foreignTable: "normalized_record" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("organization·code-value fact를 auction revision 범위에 둔다", () => {
    const config = getTableConfig(auctionOrganization);

    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name)))
      .toContainEqual(["auction_revision_id", "organization_id", "role"]);
    expect(foreignKeyColumnSets(auctionOrganization)).toEqual(expect.arrayContaining([
      { columns: ["auction_revision_id"], foreignTable: "auction_revision" },
      { columns: ["organization_id"], foreignTable: "organization" },
    ]));

    const codeConfig = getTableConfig(auctionRevisionCodeValue);
    expect(codeConfig.primaryKeys.map((key) => key.columns.map((column) => column.name)))
      .toContainEqual(["auction_revision_id", "code_value_id", "role"]);
    expect(foreignKeyColumnSets(auctionRevisionCodeValue)).toEqual(expect.arrayContaining([
      { columns: ["auction_revision_id"], foreignTable: "auction_revision" },
      { columns: ["code_value_id"], foreignTable: "code_value" },
    ]));
  });

  test("source label을 observation 범위 evidence grain에서 중복 제거한다", () => {
    expect(uniqueColumnSets(codeLabelObservation)).toContainEqual([
      "code_value_id",
      "label",
      "language",
      "observation_id",
    ]);
  });
});
