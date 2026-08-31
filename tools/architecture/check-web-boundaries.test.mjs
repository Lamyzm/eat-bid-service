import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repositoryRoot, "tools", "architecture", "check-web-boundaries.mjs");

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-web-boundaries-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(baselinePath, "{\n  \"version\": 1,\n  \"entries\": []\n}\n", "utf8");
  return { root, baselinePath, sourceRoot: path.join(root, "apps", "web", "src") };
}

async function inspect(files) {
  const subject = fixture(files);
  try {
    return await inspectWebBoundaries({
      repoRoot: subject.root,
      sourceRoot: subject.sourceRoot,
      baselinePath: subject.baselinePath,
    });
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
}

function rules(report) {
  return [...new Set(report.unmatchedFindings.map((finding) => finding.rule))];
}

test("shell의 API와 capability 의존 및 내부 deep import를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/shell/nav.ts": "import { getAuction } from '@/api/auctions';\nimport { command } from '@/capabilities/search';\n",
    "apps/web/src/capabilities/search/view.ts": "import { command } from '@/capabilities/orders/internal';\n",
    "apps/web/src/api/auctions/get.ts": "import { list } from '@/api/orders';\n",
    "apps/web/src/app/page.tsx": "import { getAuction } from '@/api/auctions/get-auction';\n",
  });

  assert.deepEqual(rules(report).sort(), ["api-resource-cross-import", "capability-internal-import", "shell-boundary-import", "web-api-deep-import"].sort());
});

test("공개 API resource index와 server import는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/app/page.tsx": "import { getAuction } from '@/api/auctions';\nimport { getAuctionFromServer } from '@/api/auctions/server';\nvoid getAuction; void getAuctionFromServer;\n",
  });

  assert.equal(report.unmatchedFindings.length, 0);
});

test("transport 밖 fetch와 안전하지 않은 JSON 응답 처리를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": [
      "export interface AuctionResponse { id: string }",
      "export async function getAuction() {",
      "  const response = await fetch('/auction');",
      "  return response.json() as AuctionResponse;",
      "}",
    ].join("\n"),
    "apps/web/src/components/card.tsx": "export async function load(response: Response) { return response.json(); }\n",
  });

  assert.deepEqual(rules(report).sort(), ["manual-api-response", "raw-fetch", "unchecked-json-cast", "unchecked-response-json"].sort());
});

test("window와 globalThis fetch 우회도 transport 밖에서 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export const load = () => window.fetch('/auction');\nexport const retry = () => globalThis.fetch('/auction');\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 2);
});

test("route client 선언과 bigint Number 변환을 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/app/page.tsx": "'use client';\nexport default function Page() { return null }\n",
    "apps/web/src/app/error.tsx": "'use client';\nexport default function Error() { return null }\n",
    "apps/web/src/routing/auction.ts": "export const auction = (auctionId: string) => Number(auctionId) + parseInt(auctionId, 10);\n",
  });

  assert.deepEqual(rules(report).sort(), ["id-number-conversion", "route-client-component"].sort());
});

test("endpoint literal과 frontend ENDPOINTS 선언을 허용된 fixture 밖에서 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export const ENDPOINTS = { auction: '/api/v1/auctions' };\n",
  });

  assert.deepEqual(rules(report).sort(), ["api-endpoint-literal", "frontend-endpoints-mirror"].sort());
});

test("완전히 같은 큰 source 그룹과 300줄 초과 source를 보고한다", async () => {
  const duplicate = Array.from({ length: 10 }, (_, index) => `export const item${index} = '${"x".repeat(16)}';`).join("\n");
  const oversized = Array.from({ length: 301 }, (_, index) => `export const line${index} = ${index};`).join("\n");
  const report = await inspect({
    "apps/web/src/shared/one.ts": duplicate,
    "apps/web/src/shared/two.ts": duplicate,
    "apps/web/src/shared/large.ts": oversized,
  });

  assert.deepEqual(rules(report).sort(), ["duplicate-source-group", "source-file-size"].sort());
  const duplicateFinding = report.unmatchedFindings.find((finding) => finding.rule === "duplicate-source-group");
  assert.deepEqual(duplicateFinding.members, ["apps/web/src/shared/one.ts", "apps/web/src/shared/two.ts"]);
});

test("정확한 legacy fingerprint는 허용하고 변경 추가 이름 변경은 거부한다", async () => {
  const subject = fixture({
    "apps/web/src/legacy.ts": "export async function load() { return fetch('/legacy') }\n",
  });
  try {
    const initial = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    const finding = initial.unmatchedFindings.find((candidate) => candidate.rule === "raw-fetch");
    writeFileSync(subject.baselinePath, `${JSON.stringify({
      version: 1,
      entries: [{
        rule: finding.rule,
        path: finding.path,
        kind: finding.kind,
        sha256: finding.sha256,
        reason: "기존 legacy fetch는 다음 transport 전환에서 제거한다.",
        owner: "EAT-9 web foundation",
        splitTrigger: "canonical resource transport가 이 module을 대체할 때",
      }],
    }, null, 2)}\n`);
    assert.equal((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).unmatchedFindings.length, 0);

    writeFileSync(path.join(subject.sourceRoot, "legacy.ts"), "export async function load() { return fetch('/changed') }\n");
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /legacy fingerprint drift/);

    writeFileSync(path.join(subject.sourceRoot, "renamed.ts"), "export async function load() { return fetch('/legacy') }\n");
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /new legacy finding/);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test("기존 baseline은 write-baseline으로 덮어쓰지 않는다", () => {
  const subject = fixture({ "apps/web/src/legacy.ts": "export const value = 1;\n" });
  try {
    assert.throws(() => execFileSync(process.execPath, [cli, "--write-baseline"], {
      cwd: repositoryRoot,
      env: { ...process.env, WEB_BOUNDARIES_ROOT: subject.root, WEB_BOUNDARIES_BASELINE: subject.baselinePath },
      encoding: "utf8",
      stdio: "pipe",
    }), /refuses to overwrite|baseline already exists/i);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});
