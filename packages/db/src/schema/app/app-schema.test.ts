import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("application identity와 workspace schema", () => {
  test("principal·workspace identity는 bigint를 쓰고 명시적 provider-subject mapping만 허용한다", async () => {
    const schema = await import("./index").catch(() => undefined);
    expect(schema, "modular app schema must exist").toBeDefined();

    const principal = getTableConfig(schema!.principal);
    const identitySubject = getTableConfig(schema!.identitySubject);
    const workspace = getTableConfig(schema!.workspace);
    const membership = getTableConfig(schema!.workspaceMembership);

    expect(principal.schema).toBe("app");
    expect(workspace.schema).toBe("app");
    expect(principal.columns.find((column) => column.name === "principal_id")?.columnType)
      .toBe("PgBigInt64");
    expect(workspace.columns.find((column) => column.name === "workspace_id")?.columnType)
      .toBe("PgBigInt64");

    expect(identitySubject.columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "identity_subject_id",
      "issuer",
      "principal_id",
      "provider",
      "subject",
    ]);
    expect(identitySubject.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "identity_subject_provider_issuer_subject_key",
    );
    expect(identitySubject.foreignKeys).toHaveLength(1);
    expect(identitySubject.foreignKeys[0]!.reference().columns.map((column) => column.name))
      .toEqual(["principal_id"]);

    expect(membership.primaryKeys[0]!.columns.map((column) => column.name)).toEqual([
      "workspace_id",
      "principal_id",
    ]);
    expect(membership.foreignKeys).toHaveLength(2);
    expect(membership.columns
      .filter((column) => ["workspace_id", "principal_id"].includes(column.name))
      .every((column) => column.columnType === "PgBigInt64")).toBe(true);
    expect(workspace.columns.map((column) => column.name)).not.toContain("subject");
    expect(membership.columns.map((column) => column.name)).not.toContain("subject");
    expect(membership.columns.map((column) => column.name)).not.toContain("provider");
  });

  test("membership role을 owner와 member로 좁히고 owner 전역 unique는 두지 않는다", async () => {
    const schema = await import("./index");
    const membership = getTableConfig(schema.workspaceMembership);

    expect(membership.checks.map((entry) => entry.name)).toContain("workspace_membership_role_allowed");
    // 한 사람이 두 워크스페이스의 owner가 될 수 없게 만드는 제약은 동시 초기화 방지가 아니라 도메인
    // 권한 제한이다. 초기화 유일성은 principal_default_workspace의 PK가 맡는다(ADR 0032 §8).
    expect(membership.uniqueConstraints).toHaveLength(0);
    expect(membership.indexes).toHaveLength(0);
  });

  test("기본 workspace 관계는 principal마다 하나이고 bigint로만 연결한다", async () => {
    const schema = await import("./index");
    const relation = getTableConfig(schema.principalDefaultWorkspace);

    expect(relation.schema).toBe("app");
    expect(relation.columns.find((column) => column.name === "principal_id")?.primary).toBe(true);
    expect(relation.columns
      .filter((column) => ["principal_id", "workspace_id"].includes(column.name))
      .every((column) => column.columnType === "PgBigInt64")).toBe(true);
    expect(relation.foreignKeys).toHaveLength(2);
  });
});

describe("등록된 사업자와 위치", () => {
  test("등록은 사업자번호를 열로 보존하고 core supplier party FK를 저장하지 않는다", async () => {
    const schema = await import("./index");
    const registration = getTableConfig(schema.registeredBusiness);

    expect(registration.schema).toBe("app");
    expect(registration.columns.map((column) => column.name).toSorted()).toEqual([
      "business_number",
      "registered_at",
      "registered_business_id",
      "registered_by_principal_id",
      "revoked_at",
      "workspace_id",
    ]);
    // 파생 FK를 저장하면 나중에 원본이 그 사업자를 처음 관측해도 저장된 null이 남아 영원히 미연결이 된다.
    expect(registration.columns.map((column) => column.name)).not.toContain("supplier_party_id");
    expect(registration.columns.map((column) => column.name)).not.toContain("linked_at");
    expect(registration.foreignKeys.map((key) => key.reference().foreignTable))
      .not.toContain(schema.supplierParty);
    expect(registration.checks.map((entry) => entry.name)).toContain("registered_business_number_digits");
  });

  test("활성 등록의 유일성은 워크스페이스 안에서만 강제한다", async () => {
    const schema = await import("./index");
    const registration = getTableConfig(schema.registeredBusiness);
    const active = registration.indexes.find((entry) => entry.config.name === "registered_business_active_number_key");

    expect(active?.config.unique).toBe(true);
    expect(active?.config.columns.map((column) => ("name" in column ? column.name : ""))).toEqual([
      "workspace_id",
      "business_number",
    ]);
    // 부분 index가 아니면 회수된 등록이 같은 번호의 재등록을 영구히 막는다.
    expect(active?.config.where).toBeDefined();
    // 사업자번호만으로 만든 전역 unique는 공개 정보에 대한 선착순 잠금이라 방어가 아니라 서비스 거부다.
    expect(registration.indexes.filter((entry) =>
      entry.config.columns.length === 1
      && entry.config.columns.some((column) => "name" in column && column.name === "business_number"))).toEqual([]);
    expect(registration.uniqueConstraints).toHaveLength(0);
  });

  test("위치는 등록별 1:1이고 좌표·행정구역 열을 두지 않는다", async () => {
    const schema = await import("./index");
    const location = getTableConfig(schema.registeredBusinessLocation);

    expect(location.columns.map((column) => column.name).toSorted()).toEqual([
      "address_text",
      "registered_business_id",
      "updated_at",
      "updated_by_principal_id",
    ]);
    expect(location.columns.find((column) => column.name === "registered_business_id")?.primary).toBe(true);
    expect(location.checks.map((entry) => entry.name))
      .toContain("registered_business_location_address_present");
  });
});
