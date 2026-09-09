import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { R2_TARGET, compareWriteMap, parseWriteMap, writeTargetsOf } from "./check-write-map.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(root, "tools", "architecture", "check-write-map.mjs");

test("모듈 소스에서 여러 줄 SQL과 f-string 표 이름과 R2 put을 쓰기 대상으로 읽는다", () => {
  const source = `
_SQL = """
insert into ingest.raw_blob (content_sha256) values (%s)
"""
cursor.execute("update\n  ingest.run set status = 'failed' where run_id = %s")
cursor.execute("select 1 from core.auction_attempt")
cursor.execute(f"insert into core.{table} ({columns}) values (%s)")
self._resolve(cursor, table="auction_organization")
self._resolve(cursor, table="auction_revision_code_value")
client.put_object(Bucket=bucket, Key=key)
`;
  const { failures, targets } = writeTargetsOf(source);

  assert.deepEqual(failures, []);
  assert.deepEqual(
    [...targets].sort(),
    ["R2", "core.auction_organization", "core.auction_revision_code_value", "ingest.raw_blob", "ingest.run"].sort(),
  );
  assert.equal(R2_TARGET, "R2");
});

test("리터럴 없는 실행 시점 표 이름 쓰기는 지도에 실을 수 없으므로 실패로 보고한다", () => {
  const { failures, targets } = writeTargetsOf('cursor.execute(f"delete from mart.{name} where build_id = %s")');

  assert.equal(targets.size, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /mart\.\{name\}/u);
});

const document = `# 지도

## 단계

| 단계 | 모듈 | 쓰는 곳 | 근거 |
| --- | --- | --- | --- |
| capture | \`ingest/postgres_repository.py\` | \`ingest.raw_blob\`, \`ingest.raw_observation\` | ADR 0010 |
| capture | \`storage/r2_store.py\` | \`R2 raw/{source}/{endpoint}/{sha256}.{xml\\|txt}.gz\` | ADR 0010 |
| discover | \`ingest/postgres_repository.py\` | \`ingest.run\` | ADR 0025 |
`;

test("지도 표는 헤더 이름으로 열을 찾고 escaped pipe를 글자로 읽으며 같은 모듈의 여러 행을 합집합으로 읽는다", () => {
  const { documented, failures } = parseWriteMap(document);

  assert.deepEqual(failures, []);
  assert.equal(documented.size, 2);
  assert.deepEqual([...documented.get("ingest/postgres_repository.py")].sort(), ["ingest.raw_blob", "ingest.raw_observation", "ingest.run"]);
  assert.deepEqual([...documented.get("storage/r2_store.py")], ["R2"]);
  assert.match(parseWriteMap("# 표 없음\n").failures[0], /찾지 못했습니다/u);
  assert.match(parseWriteMap("| 모듈 | 쓰는 곳 |\n| --- | --- |\n| `a/b.py` | `public.x` |\n").failures[0], /읽을 수 없습니다/u);
});

test("비교는 빠진 대상·남은 대상·지도에 없는 모듈·더 이상 쓰지 않는 모듈을 각각 보고한다", () => {
  const { documented } = parseWriteMap(document);
  const modules = new Map([
    ["ingest/postgres_repository.py", new Set(["ingest.raw_blob", "ingest.raw_observation", "ingest.request_unit"])],
    ["core/new_writer.py", new Set(["core.organization"])],
  ]);

  const failures = compareWriteMap({ documented, modules });

  assert.equal(failures.length, 4, failures.join("\n"));
  assert.match(failures.join("\n"), /빠진 쓰기 대상: ingest\/postgres_repository\.py → ingest\.request_unit/u);
  assert.match(failures.join("\n"), /소스에 없는 쓰기 대상.*ingest\.run/u);
  assert.match(failures.join("\n"), /지도에 없는 쓰기 모듈: core\/new_writer\.py/u);
  assert.match(failures.join("\n"), /더 이상 쓰지 않습니다: storage\/r2_store\.py/u);
  assert.deepEqual(
    compareWriteMap({
      documented,
      modules: new Map([
        ["ingest/postgres_repository.py", new Set(["ingest.raw_blob", "ingest.raw_observation", "ingest.run"])],
        ["storage/r2_store.py", new Set(["R2"])],
      ]),
    }),
    [],
  );
});

test("실제 검사기는 fixture 저장소에서 소스와 지도를 대조하고 __pycache__·테스트 파일은 읽지 않는다", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "eatbid-write-map-"));
  try {
    const source = path.join(directory, "apps", "dataplane", "src", "eatbid");
    mkdirSync(path.join(source, "ingest", "__pycache__"), { recursive: true });
    mkdirSync(path.join(source, "storage"), { recursive: true });
    mkdirSync(path.join(directory, "docs", "architecture"), { recursive: true });
    writeFileSync(path.join(source, "ingest", "postgres_repository.py"), 'cursor.execute("insert into ingest.raw_blob values (1)")\ncursor.execute("insert into ingest.raw_observation values (1)")\ncursor.execute("insert into ingest.run values (1)")\n', "utf8");
    writeFileSync(path.join(source, "ingest", "__pycache__", "junk.py"), 'cursor.execute("insert into ingest.junk values (1)")\n', "utf8");
    writeFileSync(path.join(source, "ingest", "test_repository.py"), 'cursor.execute("insert into ingest.fixture values (1)")\n', "utf8");
    writeFileSync(path.join(source, "storage", "r2_store.py"), "client.put_object(Bucket=b, Key=k)\n", "utf8");
    const documentPath = path.join(directory, "docs", "architecture", "ingestion-write-map.md");
    writeFileSync(documentPath, document, "utf8");

    const passed = spawnSync(process.execPath, [checker], { encoding: "utf8", env: { ...process.env, WRITE_MAP_ROOT: directory } });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /쓰기 모듈 2개, 대상 4개/u);

    writeFileSync(path.join(source, "ingest", "postgres_repository.py"), 'cursor.execute("insert into ingest.raw_blob values (1)")\ncursor.execute("update ingest.request_unit set x = 1")\n', "utf8");
    const failed = spawnSync(process.execPath, [checker], { encoding: "utf8", env: { ...process.env, WRITE_MAP_ROOT: directory } });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /ingest\.request_unit/u);
    assert.match(failed.stderr, /ingest\.raw_observation, ingest\.run/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("추적된 수집 쓰기 지도는 실제 dataplane 소스와 같다", () => {
  const output = execFileSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
  assert.match(output, /검사가 통과했습니다/u);
});
