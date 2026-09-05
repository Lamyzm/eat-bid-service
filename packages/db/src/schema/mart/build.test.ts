import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { martBuild, martBuildStatuses, martNames } from "./build";
import {
  checkNames,
  columnNames,
  columnNullability,
  columnSqlTypes,
  foreignKeyColumnSets,
  migrationSql,
  nullsNotDistinctUniqueColumnSets,
} from "./table-config.fixture";

const buildMigration = "20260905215517_mart_build_ledger";

describe("mart.build 스키마", () => {
  test("빌드 정체성과 계보 시각을 원장 한 곳이 소유한다", () => {
    const config = getTableConfig(martBuild);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("build");
    expect(columnNames(martBuild)).toEqual([
      "build_id",
      "mart_name",
      "source_release_id",
      "publication_id",
      "calc_version",
      "builder_version",
      "region_scheme",
      "status",
      "as_of",
      "started_at",
      "computed_at",
      "activated_at",
      "superseded_at",
      "row_count",
      "retain_until",
      "failure_category",
    ]);
  });

  test("봉인된 입력 release는 필수이고 발행은 선택이다", () => {
    const nullability = columnNullability(martBuild);
    const types = columnSqlTypes(martBuild);

    expect(nullability.source_release_id).toBe(true);
    expect(nullability.publication_id).toBe(false);
    expect(types.source_release_id).toBe("uuid");
    expect(types.publication_id).toBe("uuid");
    expect(types.builder_version).toBe("varchar(64)");
    expect(types.calc_version).toBe("varchar(32)");
    expect(types.region_scheme).toBe("varchar(64)");
    expect(foreignKeyColumnSets(martBuild)).toEqual([
      { columns: ["source_release_id"], foreignTable: "source_release" },
      { columns: ["publication_id"], foreignTable: "publication" },
    ]);
  });

  test("멱등 키가 발행 없는 수동 재빌드도 하나로 묶는다", () => {
    expect(nullsNotDistinctUniqueColumnSets(martBuild)).toEqual([
      ["mart_name", "calc_version", "source_release_id", "publication_id"],
    ]);
  });

  test("mart 이름과 상태를 목록으로 못 박는다", () => {
    expect([...martNames]).toEqual([
      "org_round_summary",
      "win_rate_distribution_monthly",
      "open_auction_snapshot",
    ]);
    expect([...martBuildStatuses]).toEqual(["building", "verified", "active", "superseded", "failed"]);
    expect(checkNames(martBuild)).toContain("mart_build_name_allowed");
    expect(checkNames(martBuild)).toContain("mart_build_status_allowed");
  });

  test("검증·활성·실패 상태가 자기 증거 없이는 성립하지 않는다", () => {
    const checks = checkNames(martBuild);

    expect(checks).toContain("mart_build_verified_requires_evidence");
    expect(checks).toContain("mart_build_active_requires_activation");
    expect(checks).toContain("mart_build_superseded_requires_timestamp");
    expect(checks).toContain("mart_build_failed_requires_category");
    expect(checks).toContain("mart_build_failed_is_never_activated");
  });
});

describe("mart.build 활성 포인터 migration", () => {
  test("활성 build를 mart마다 하나로 강제하는 partial unique index를 커밋한다", () => {
    const sql = migrationSql(buildMigration);

    expect(sql).toContain('CREATE UNIQUE INDEX "mart_build_active_key"');
    expect(sql).toContain(`WHERE "status" = 'active'`);
  });

  test("상태 전이 넷만 허용하는 trigger와 mart 행 쓰기 guard를 손으로 이어 붙인다", () => {
    const sql = migrationSql(buildMigration);

    expect(sql).toContain('CREATE FUNCTION "mart"."enforce_mart_build_transition"()');
    expect(sql).toContain('CREATE TRIGGER "mart_build_transition"');
    // mart 행 쓰기는 building build에만 허용한다. 이 함수를 T3의 mart 표들이 공유한다.
    expect(sql).toContain('CREATE FUNCTION "mart"."enforce_mart_row_build_is_building"()');
    for (const transition of ["building", "verified", "active", "superseded", "failed"]) {
      expect(sql).toContain(`'${transition}'`);
    }
  });
});
