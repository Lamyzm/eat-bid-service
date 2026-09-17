import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { countCommittedMigrations } from "./container.mjs";
import { resolvePorts } from "./db.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("커밋된 migration 세기", () => {
  test("시각 접두사를 가진 폴더만 세고 파일과 다른 폴더는 빼놓는다", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "eatbid-migrations-"));
    mkdirSync(path.join(folder, "20260829000000_ingest_foundation"));
    mkdirSync(path.join(folder, "20260830021619_app_workspace_foundation"));
    mkdirSync(path.join(folder, "meta"));
    writeFileSync(path.join(folder, "README.md"), "");
    assert.equal(countCommittedMigrations(folder), 2);
  });

  test("저장소의 migration 폴더 수가 곧 적용되어야 할 개수다", () => {
    const folder = path.join(repoRoot, "packages/db/drizzle");
    const directories = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
    assert.equal(countCommittedMigrations(folder), directories);
    assert.ok(directories >= 45, "migration은 줄어들지 않는다");
  });
});

describe("포트 결정 순서", () => {
  const ranges = [{ start: 4552, end: 4651 }];
  const stored = {
    EATBID_DEV_DB_PORT: "15433",
    EATBID_DEV_API_PORT: "4300",
    EATBID_DEV_WEB_PORT: "3000",
  };

  const allFree = async () => true;

  test("기기 파일에 이미 있고 아직 비어 있는 포트는 그대로 쓴다", async () => {
    const resolved = await resolvePorts(stored, { ranges, environment: {}, free: allFree });
    assert.equal(resolved.EATBID_DEV_API_PORT, "4300");
    assert.equal(resolved.EATBID_DEV_WEB_PORT, "3000");
  });

  test("기기 파일의 포트를 남이 쓰고 있으면 옆자리로 옮겨 적는다", async () => {
    const resolved = await resolvePorts(stored, {
      ranges,
      environment: {},
      free: async (port) => port !== 3000,
    });
    assert.equal(resolved.EATBID_DEV_WEB_PORT, "3001");
  });

  test("이미 떠 있는 컨테이너가 잡은 DB 포트만 빈자리 검사에서 뺀다", async () => {
    const resolved = await resolvePorts(stored, {
      ranges,
      environment: {},
      databasePortHeld: true,
      free: async (port) => port !== 15_433,
    });
    assert.equal(resolved.EATBID_DEV_DB_PORT, "15433");
  });

  test("환경으로 못 박은 포트가 예약 대역이면 조용히 옮기지 않고 거절한다", async () => {
    await assert.rejects(
      resolvePorts({ ...stored, EATBID_DEV_API_PORT: "4600" }, {
        ranges,
        environment: { EATBID_DEV_API_PORT: "4600" },
        free: allFree,
      }),
      /예약 대역/,
    );
  });

  test("환경으로 못 박은 포트가 쓸 수 있으면 기기 파일 값을 덮는다", async () => {
    const resolved = await resolvePorts({ ...stored, EATBID_DEV_API_PORT: "4301" }, {
      ranges,
      environment: { EATBID_DEV_API_PORT: "4301" },
      free: allFree,
    });
    assert.equal(resolved.EATBID_DEV_API_PORT, "4301");
  });
});

describe("합성 표본 자료 파일", () => {
  const sampleFolder = path.join(repoRoot, "tools/dev/sample");

  test("적재 순서가 파일 이름의 숫자 접두사로 정해진다", () => {
    const files = readdirSync(sampleFolder).filter((name) => name.endsWith(".sql")).sort();
    assert.deepEqual(files, [
      "10-evidence.sql",
      "20-vocabulary.sql",
      "30-auctions.sql",
      "35-bidding.sql",
      "40-mart.sql",
      "50-workspace.sql",
    ]);
  });
});
