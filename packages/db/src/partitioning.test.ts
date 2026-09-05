import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const migrationRoot = fileURLToPath(new URL("../drizzle/", import.meta.url));

// 파티션 DDL은 drizzle-kit이 표현하지 못해 생성된 migration.sql에 손으로 이어 붙인 부분이다.
// 다음 generate가 그 부분을 조용히 지우지 않도록 SQL 파일 자체를 읽어 단언한다(ADR 0033 §3).
const readBidSubmissionMigration = async (): Promise<string> => {
  const folders = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folder of folders) {
    const sql = await readFile(path.join(migrationRoot, folder, "migration.sql"), "utf8");
    if (sql.includes(`CREATE TABLE "core"."bid_submission"`)) {
      return sql;
    }
  }

  throw new Error("core.bid_submission을 만드는 migration을 찾지 못했다");
};

const partitionYears = [2023, 2024, 2025, 2026, 2027] as const;

describe("개찰 연도 파티션 DDL", () => {
  test("bid_submission 마이그레이션은 개찰 시각으로 range 파티션한다", async () => {
    const sql = await readBidSubmissionMigration();

    expect(sql).toContain(`) PARTITION BY RANGE ("opened_at");`);
    expect(sql).not.toContain(`PARTITION BY HASH`);
    expect(sql).not.toContain(`PARTITION BY LIST`);
  });

  test("연도 파티션 경계를 한국 시간으로 적는다", async () => {
    const sql = await readBidSubmissionMigration();

    for (const year of partitionYears) {
      expect(sql).toContain(
        `CREATE TABLE "core"."bid_submission_${year}" PARTITION OF "core"."bid_submission"`,
      );
      expect(sql).toContain(
        `FOR VALUES FROM ('${year}-01-01 00:00:00+09') TO ('${year + 1}-01-01 00:00:00+09')`,
      );
    }
  });

  test("개찰 시각을 모르는 명단을 받을 default 파티션을 둔다", async () => {
    const sql = await readBidSubmissionMigration();

    expect(sql).toContain(
      `CREATE TABLE "core"."bid_submission_unpartitioned" PARTITION OF "core"."bid_submission" DEFAULT;`,
    );
  });

  test("대리키와 발행 grain을 nulls not distinct unique로 지킨다", async () => {
    const sql = await readBidSubmissionMigration();

    expect(sql).toContain(`UNIQUE NULLS NOT DISTINCT("bid_submission_id","opened_at")`);
    expect(sql).toContain(
      `UNIQUE NULLS NOT DISTINCT("auction_revision_id","roster_ordinal","opened_at")`,
    );
    expect(sql).not.toContain(`"bid_submission_id" bigint PRIMARY KEY`);
  });
});
