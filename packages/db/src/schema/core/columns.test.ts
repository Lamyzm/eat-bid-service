import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  auctionAttempt,
  auctionOrganization,
  auctionRevision,
  auctionRevisionCodeValue,
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

describe("canonical column 계약", () => {
  test("모든 canonical table의 필수 column과 nullability를 정확히 정의한다", () => {
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
      canonical_name: false,
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
    ]);
    expect(columnNullability(auctionAttempt)).toEqual({
      auction_attempt_id: true,
      source_system: true,
      external_bid_id: true,
    });
    expect(columnNames(auctionRevision)).toEqual([
      "auction_revision_id",
      "auction_attempt_id",
      "normalized_record_id",
      "observation_id",
      "content_sha256",
      "display_bid_no",
      "source_status",
      "title",
      "announced_at",
      "deadline_at",
      "opened_at",
      "base_amount",
      "planned_amount",
      "floor_rate",
      "currency",
      "source_payload",
    ]);
    expect(columnNullability(auctionRevision)).toEqual({
      auction_revision_id: true,
      auction_attempt_id: true,
      normalized_record_id: true,
      observation_id: true,
      content_sha256: true,
      display_bid_no: false,
      source_status: true,
      title: true,
      announced_at: false,
      deadline_at: false,
      opened_at: false,
      base_amount: false,
      planned_amount: false,
      floor_rate: false,
      currency: true,
      source_payload: true,
    });
    expect(columnNames(auctionOrganization)).toEqual([
      "auction_revision_id",
      "organization_id",
      "role",
    ]);
    expect(columnNullability(auctionOrganization)).toEqual({
      auction_revision_id: true,
      organization_id: true,
      role: true,
    });
    expect(columnNames(auctionRevisionCodeValue)).toEqual([
      "auction_revision_id",
      "code_value_id",
      "role",
    ]);
    expect(columnNullability(auctionRevisionCodeValue)).toEqual({
      auction_revision_id: true,
      code_value_id: true,
      role: true,
    });
  });

  test("모든 canonical table의 named-check 계약을 빠짐없이 정의한다", () => {
    const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).checks.map((check) => check.name);

    for (const [table, expectedCheckNames] of [
      [codeScheme, []],
      [codeValue, ["code_value_valid_time_order"]],
      [codeLabelObservation, []],
      [codeMapping, ["code_mapping_has_validity_boundary", "code_mapping_valid_time_order"]],
      [organization, []],
      [organizationIdentifier, []],
      [auctionAttempt, []],
      [auctionRevision, ["auction_revision_planned_amount_positive"]],
      [auctionOrganization, []],
      [auctionRevisionCodeValue, ["auction_revision_code_value_role_allowed"]],
    ] as const) {
      expect(checkNames(table)).toEqual(expectedCheckNames);
    }
  });
});
