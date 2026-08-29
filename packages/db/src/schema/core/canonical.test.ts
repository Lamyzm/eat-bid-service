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
      expect(column?.generatedIdentity).toEqual({ type: "always" });
    }

    expect(columns(auctionOrganization).every((column) => column.generatedIdentity === undefined)).toBe(true);
  });

  test("defines exact required columns and nullability for every canonical table", () => {
    expect(columnNames(codeScheme)).toEqual([
      "code_scheme_id",
      "namespace",
      "owner",
      "version_policy",
      "valid_time_policy",
    ]);
    expect(columnNullability(codeScheme)).toEqual({
      code_scheme_id: true,
      namespace: true,
      owner: true,
      version_policy: true,
      valid_time_policy: true,
    });
    expect(columnNames(codeValue)).toEqual([
      "code_value_id",
      "code_scheme_id",
      "code",
      "valid_from",
      "valid_to",
      "active",
    ]);
    expect(columnNullability(codeValue)).toEqual({
      code_value_id: true,
      code_scheme_id: true,
      code: true,
      valid_from: false,
      valid_to: false,
      active: true,
    });
    expect(columnNames(codeLabelObservation)).toEqual([
      "code_label_observation_id",
      "code_value_id",
      "label",
      "language",
      "observed_at",
      "observation_id",
    ]);
    expect(columnNullability(codeLabelObservation)).toEqual({
      code_label_observation_id: true,
      code_value_id: true,
      label: true,
      language: true,
      observed_at: true,
      observation_id: true,
    });
    expect(columnNames(codeMapping)).toEqual([
      "code_mapping_id",
      "from_code_value_id",
      "to_code_value_id",
      "relation",
      "valid_from",
      "valid_to",
      "evidence_observation_id",
      "status",
    ]);
    expect(columnNullability(codeMapping)).toEqual({
      code_mapping_id: true,
      from_code_value_id: true,
      to_code_value_id: true,
      relation: true,
      valid_from: false,
      valid_to: false,
      evidence_observation_id: true,
      status: true,
    });
    expect(columnNames(organization)).toEqual([
      "organization_id",
      "type",
      "canonical_name",
      "created_at",
    ]);
    expect(columnNullability(organization)).toEqual({
      organization_id: true,
      type: true,
      canonical_name: true,
      created_at: true,
    });
    expect(columnNames(organizationIdentifier)).toEqual([
      "organization_identifier_id",
      "organization_id",
      "code_value_id",
      "observation_id",
    ]);
    expect(columnNullability(organizationIdentifier)).toEqual({
      organization_identifier_id: true,
      organization_id: true,
      code_value_id: true,
      observation_id: true,
    });
    expect(columnNames(auctionAttempt)).toEqual([
      "auction_attempt_id",
      "source_system",
      "external_bid_id",
      "display_bid_no",
    ]);
    expect(columnNullability(auctionAttempt)).toEqual({
      auction_attempt_id: true,
      source_system: true,
      external_bid_id: true,
      display_bid_no: true,
    });
    expect(columnNames(auctionRevision)).toEqual([
      "auction_revision_id",
      "auction_attempt_id",
      "observation_id",
      "content_sha256",
      "source_status",
      "title",
      "announced_at",
      "deadline_at",
      "opened_at",
      "base_amount",
      "planned_amount",
      "currency",
      "source_payload",
    ]);
    expect(columnNullability(auctionRevision)).toEqual({
      auction_revision_id: true,
      auction_attempt_id: true,
      observation_id: true,
      content_sha256: true,
      source_status: true,
      title: true,
      announced_at: false,
      deadline_at: false,
      opened_at: false,
      base_amount: false,
      planned_amount: false,
      currency: false,
      source_payload: true,
    });
    expect(columnNames(auctionOrganization)).toEqual([
      "auction_attempt_id",
      "organization_id",
      "role",
    ]);
    expect(columnNullability(auctionOrganization)).toEqual({
      auction_attempt_id: true,
      organization_id: true,
      role: true,
    });
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

  test("enforces explicit, ordered code validity ranges", () => {
    const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).checks.map((check) => check.name);

    expect(checkNames(codeValue)).toContain("code_value_valid_time_order");
    expect(checkNames(codeMapping)).toEqual(expect.arrayContaining([
      "code_mapping_has_validity_boundary",
      "code_mapping_valid_time_order",
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
