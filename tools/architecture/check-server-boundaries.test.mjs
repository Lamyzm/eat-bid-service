import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectServerBoundaries } from "./check-server-boundaries.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repositoryRoot, "tools", "architecture", "check-server-boundaries.mjs");

function inspect(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-server-boundaries-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = path.join(root, "apps", "server", "src", "modules", relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
    return inspectServerBoundaries({ repoRoot: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("application이 계약의 V1 응답 타입을 import하면 거부한다", () => {
  const report = inspect({
    "procurement/application/find-auction.ts":
      'import { type AuctionV1Response, type MartCoverage } from "@eatbid/contracts";\nexport const x = 1;\n',
  });
  assert.equal(report.inspectedCount, 1);
  assert.deepEqual(report.findings.map((item) => [item.rule, item.line]), [["application-imports-wire-type", 1]]);
  assert.match(report.findings[0].reason, /AuctionV1Response/u);
});

test("alias로 이름을 바꾸거나 namespace로 통째로 가져와도 거부한다", () => {
  const report = inspect({
    "procurement/application/a.ts": 'import { type MartBuildLineageWire as Lineage } from "@eatbid/contracts";\nexport const x = 1;\n',
    "procurement/application/b.ts": 'import * as contracts from "@eatbid/contracts";\nexport const y = contracts;\n',
    "reference/application/c.ts": 'import { listCodesV1ResponseSchema } from "@eatbid/contracts";\nexport const z = listCodesV1ResponseSchema;\n',
  });
  assert.deepEqual(report.findings.map((item) => item.path).sort(), [
    "apps/server/src/modules/procurement/application/a.ts",
    "apps/server/src/modules/procurement/application/b.ts",
    "apps/server/src/modules/reference/application/c.ts",
  ]);
});

test("접미사 없는 enum 어휘와 codec은 application 입력의 낱말이라 통과한다", () => {
  const report = inspect({
    "procurement/application/mart-build-lineage.ts":
      'import type { MartCoverage, MyBidEvidenceConflict, OrganizationAttemptOpenedFilter } from "@eatbid/contracts";\nexport type X = MartCoverage;\n',
  });
  assert.deepEqual(report.findings, []);
});

test("presentation과 테스트 파일은 wire 타입을 당연히 쓰므로 대상이 아니다", () => {
  const report = inspect({
    "procurement/presentation/http/auction.presenter.ts": 'import type { AuctionV1Response } from "@eatbid/contracts";\nexport const x = 1;\n',
    "procurement/application/find-auction.test.ts": 'import type { AuctionV1Response } from "@eatbid/contracts";\nexport const x = 1;\n',
    "procurement/infrastructure/drizzle/reader.ts": 'import { martCoverageSchema } from "@eatbid/contracts";\nexport const y = martCoverageSchema;\n',
  });
  assert.equal(report.inspectedCount, 0);
  assert.deepEqual(report.findings, []);
});

test("저장소 전체에서 Server module 경계 검사가 통과한다", () => {
  const output = execFileSync(process.execPath, [cli], { cwd: repositoryRoot, encoding: "utf8" });
  assert.match(output, /통과했습니다/u);
});
