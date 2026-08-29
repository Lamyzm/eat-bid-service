import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  auctionAttempt,
  auctionOrganization,
  auctionRevision,
  codeLabelObservation,
  codeMapping,
  codeScheme,
  codeValue,
  organization,
  organizationIdentifier,
} from "./index";

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns;

const columnNames = (table: Parameters<typeof getTableConfig>[0]) => columns(table).map((column) => column.name);

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

describe("canonical identities", () => {
  test("uses generated bigint primary keys for every independently identified fact", () => {
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
    }
  });

  test("keeps code source evidence as text within a unique scheme", () => {
    const code = columns(codeValue).find((column) => column.name === "code");

    expect(code?.getSQLType()).toBe("text");
    expect(uniqueColumnSets(codeScheme)).toContainEqual(["namespace"]);
    expect(uniqueColumnSets(codeValue)).toContainEqual(["code_scheme_id", "code"]);
  });

  test("keeps code registry tables at their stated grain with observed evidence", () => {
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

  test("uses the single code-value authority for organization identity", () => {
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

  test("does not promote organization names or display bid numbers to identities", () => {
    expect(uniqueColumnSets(organization)).not.toContainEqual(["canonical_name"]);
    expect(uniqueColumnSets(auctionAttempt)).not.toContainEqual(["display_bid_no"]);
  });

  test("scopes auction identity to the source and preserves revision evidence", () => {
    expect(uniqueColumnSets(auctionAttempt)).toContainEqual(["source_system", "external_bid_id"]);
    expect(uniqueColumnSets(auctionRevision)).toContainEqual(["auction_attempt_id", "content_sha256"]);
    expect(foreignKeyColumnSets(auctionRevision)).toEqual(expect.arrayContaining([
      { columns: ["auction_attempt_id"], foreignTable: "auction_attempt" },
      { columns: ["observation_id"], foreignTable: "raw_observation" },
    ]));
  });

  test("uses the attempt, organization, and role as the auction organization identity", () => {
    const config = getTableConfig(auctionOrganization);

    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name)))
      .toContainEqual(["auction_attempt_id", "organization_id", "role"]);
    expect(foreignKeyColumnSets(auctionOrganization)).toEqual(expect.arrayContaining([
      { columns: ["auction_attempt_id"], foreignTable: "auction_attempt" },
      { columns: ["organization_id"], foreignTable: "organization" },
    ]));
  });
});
