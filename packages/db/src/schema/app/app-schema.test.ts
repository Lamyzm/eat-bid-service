import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("검증 범위를 정의한다 — application identity and workspace schema", () => {
  test("사용 계약을 검증한다 — uses bigint principal/workspace identity and only explicit provider-subject mapping", async () => {
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
});
