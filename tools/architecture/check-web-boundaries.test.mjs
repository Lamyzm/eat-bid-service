import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";
import { isTestOrFixture } from "./web-boundaries/policy.mjs";

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
    "apps/web/src/api/auctions/index.ts": "export const getAuction = () => undefined;\n",
    "apps/web/src/api/auctions/get-auction.ts": "export const privateAuction = () => undefined;\n",
    "apps/web/src/api/orders/index.ts": "export const list = () => undefined;\n",
    "apps/web/src/capabilities/search/index.ts": "export const command = () => undefined;\n",
    "apps/web/src/capabilities/orders/internal.ts": "export const command = () => undefined;\n",
  });

  assert.deepEqual(rules(report).sort(), ["api-resource-cross-import", "capability-internal-import", "shell-boundary-import", "web-api-deep-import"].sort());
});

test("공개 API resource index와 server import는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/app/page.tsx": "import { getAuction } from '@/api/auctions';\nimport { getAuctionFromServer } from '@/api/auctions/server';\nvoid getAuction; void getAuctionFromServer;\n",
    "apps/web/src/api/auctions/index.ts": "export const getAuction = () => undefined;\n",
    "apps/web/src/api/auctions/server.ts": "export const getAuctionFromServer = () => undefined;\n",
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

test("legacy baseline은 삭제를 허용하고 replacement rename addition multiplicity를 분리한다", async () => {
  const subject = fixture({ "apps/web/src/legacy.ts": "fetch('/same');\nfetch('/same');\n" });
  try {
    const initial = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    const [first] = initial.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch");
    const baseline = { version: 1, entries: [{ ...first, reason: "legacy", owner: "EAT-9", splitTrigger: "migrate" }] };
    writeFileSync(subject.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    const multiplicity = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    assert.match(multiplicity.baselineFailures.join("\n"), /multiplicity increase/);

    writeFileSync(path.join(subject.sourceRoot, "legacy.ts"), "");
    const deletion = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    assert.equal(deletion.baselineFailures.length, 0);

    writeFileSync(path.join(subject.sourceRoot, "legacy.ts"), "fetch('/replacement');\n");
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /fingerprint drift/);

    writeFileSync(path.join(subject.sourceRoot, "legacy.ts"), "");
    writeFileSync(path.join(subject.sourceRoot, "renamed.ts"), "fetch('/same');\n");
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /new legacy finding/);

    writeFileSync(path.join(subject.sourceRoot, "added.ts"), "fetch('/added');\n");
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /new legacy finding/);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test("import와 export-from은 resource public entry와 transport 소유권을 강제한다", async () => {
  const report = await inspect({
    "apps/web/src/capabilities/search/view.ts": "export { privateAuction } from '@/api/auctions/get-auction';\n",
    "apps/web/src/api/auctions/index.ts": "import { browserRequest } from '@/api/_transport/browser-request'; export { browserRequest };\n",
    "apps/web/src/api/auctions/server.ts": "export { serverRequest } from '@/api/_transport/server-request.server';\n",
    "apps/web/src/api/auctions/get.ts": "import { browserRequest } from '@/api/_transport/browser-request'; import { serverRequest } from '@/api/_transport/server-request.server'; import { ContractRequest } from '@/api/_transport/request-contract'; void browserRequest; void serverRequest; void (null as unknown as ContractRequest);\n",
    "apps/web/src/api/auctions/operation.ts": "import type { ContractRequest } from '@/api/_transport/request-contract'; export type Request = ContractRequest;\n",
    "apps/web/src/api/auctions/get-auction.ts": "export const privateAuction = () => undefined;\n",
    "apps/web/src/api/_transport/browser-request.ts": "export const browserRequest = () => undefined;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "export const serverRequest = () => undefined;\n",
    "apps/web/src/api/_transport/request-contract.ts": "export interface ContractRequest {}\n",
  });

  assert.deepEqual(rules(report).sort(), ["resource-transport-import", "web-api-deep-import"].sort());
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 4);
});

test("전역 fetch와 Response decoder만 검사하고 shadow parser는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": [
      "const fetch = (path: string) => path;",
      "const parser = { json: () => ({}) };",
      "export const safe = () => { fetch('local'); return parser.json(); };",
      "export async function unsafe(response: Response) { return [response.text(), response.arrayBuffer(), response.blob(), response.formData(), response.json() as { id: string }]; }",
    ].join("\n"),
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 0);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 0);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-json-cast").length, 1);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 4);
});

test("ID 변환만 검사하고 pagination timestamp slider month 변환은 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/routing/ids.ts": "type AuctionId = string & { readonly brand: 'AuctionId' }; export const id = (auctionId: string, branded: AuctionId, createdAt: string, page: string, sliderValue: string, month: string) => [Number(auctionId), parseInt(branded, 10), Number(createdAt), Number(page), Number(sliderValue), parseInt(month, 10)];\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "id-number-conversion").length, 2);
});

test("v1 v2 endpoint literal은 막고 package import와 fixture authority는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions'; export const paths = ['/api/v1/auctions', '/api/v2/auctions']; void auctionV1Operations;\n",
    "apps/web/src/api/auctions/fixture.test.ts": "export const fixture = '/api/v2/allowed';\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 2);
});

test("간접 manual DTO export는 막고 imported contract alias는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export { LegacyResponse } from './legacy'; export type { AuctionResponse } from './contract';\n",
    "apps/web/src/api/auctions/legacy.ts": "export interface LegacyResponse { id: string }\n",
    "apps/web/src/api/auctions/contract.ts": "import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions'; export type AuctionResponse = AuctionV1Response;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "manual-api-response").length, 1);
});

test("physical line count는 300 경계의 trailing newline을 올림하지 않는다", async () => {
  const lines = (count, trailing = "") => `${Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join("\n")}${trailing}`;
  const report = await inspect({
    "apps/web/src/shared/exact.ts": lines(300),
    "apps/web/src/shared/exact-trailing.ts": lines(300, "\n"),
    "apps/web/src/shared/too-large.ts": lines(301, "\n"),
  });

  assert.deepEqual(report.unmatchedFindings.filter((finding) => finding.rule === "source-file-size").map((finding) => finding.path), ["apps/web/src/shared/too-large.ts"]);
});

test("source-derived fingerprint은 같은 category 편집과 duplicate group 동시 편집을 거부한다", async () => {
  const duplicate = (suffix) => Array.from({ length: 10 }, (_, index) => `export const item${index} = '${suffix}-${"x".repeat(16)}';`).join("\n");
  const subject = fixture({
    "apps/web/src/app/page.tsx": `'use client';\n${Array.from({ length: 300 }, (_, index) => `export const page${index} = ${index};`).join("\n")}\n`,
    "apps/web/src/shared/one.ts": duplicate("before"),
    "apps/web/src/shared/two.ts": duplicate("before"),
  });
  try {
    const initial = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    writeFileSync(subject.baselinePath, `${JSON.stringify({ version: 1, entries: initial.findings.map((finding) => ({ ...finding, reason: "legacy", owner: "EAT-9", splitTrigger: "migrate" })) }, null, 2)}\n`);
    writeFileSync(path.join(subject.sourceRoot, "app", "page.tsx"), `'use client';\n// edited but still a client route\n${Array.from({ length: 300 }, (_, index) => `export const page${index} = ${index};`).join("\n")}\n`);
    writeFileSync(path.join(subject.sourceRoot, "shared", "one.ts"), duplicate("after"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "two.ts"), duplicate("after"));
    const changed = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    assert.equal(changed.baselineFailures.filter((failure) => /fingerprint drift/.test(failure)).length, 3);

    writeFileSync(path.join(subject.sourceRoot, "app", "page.tsx"), "export default function Page() { return null }\n");
    writeFileSync(path.join(subject.sourceRoot, "shared", "one.ts"), "export const one = 1;\n");
    writeFileSync(path.join(subject.sourceRoot, "shared", "two.ts"), "export const two = 2;\n");
    assert.equal((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.length, 0);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test("transport import은 exact owner와 ContractRequest type-only form만 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "import { browserRequest } from '@/api/_transport/browser-request'; void browserRequest;\n",
    "apps/web/src/api/auctions/server.ts": "import { serverRequest } from '@/api/_transport/server-request.server'; void serverRequest;\n",
    "apps/web/src/api/auctions/whole.ts": "import type { ContractRequest } from '@/api/_transport/request-contract'; export type Whole = ContractRequest;\n",
    "apps/web/src/api/auctions/specifier.ts": "import { type ContractRequest } from '@/api/_transport/request-contract'; export type Specifier = ContractRequest;\n",
    "apps/web/src/api/auctions/bad.ts": "export { browserRequest } from '@/api/_transport/browser-request'; import { ContractRequest, other } from '@/api/_transport/request-contract'; import { anything } from '@/api/_transport/private'; void ContractRequest; void other; void anything;\n",
    "apps/web/src/api/orders/index.ts": "import type { browserRequest } from '@/api/_transport/browser-request'; export type Browser = typeof browserRequest;\n",
    "apps/web/src/api/orders/server.ts": "import { type serverRequest } from '@/api/_transport/server-request.server'; export type Server = typeof serverRequest;\n",
    "apps/web/src/api/_transport/browser-request.ts": "export const browserRequest = () => undefined;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "export const serverRequest = () => undefined;\n",
    "apps/web/src/api/_transport/request-contract.ts": "export interface ContractRequest {} export const other = 1;\n",
    "apps/web/src/api/_transport/private.ts": "export const anything = 1;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 5);
});

test("Response subclass union decoder는 막고 local parser decoder는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "class CustomResponse extends Response {} const parser = { json: () => 1 }; export function load(response: CustomResponse | (Response & {})) { parser.json(); return [response.json(), response.text()]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 1);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 1);
});

test("dynamic contract import과 Windows fixture path는 허용하고 Web openapi v9 literal은 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/openapi/bypass.ts": "export const path = '/api/v9/bypass';\n",
    "apps/web/src/api/auctions/get.ts": "export const load = () => import('@eatbid/contracts/api/v1/auctions');\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 1);
  assert.equal(isTestOrFixture("apps\\web\\src\\fixtures\\authority.ts"), true);
});

test("local alias와 generic wrapper manual DTO는 막고 contract alias는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export type { AuctionResponse } from './shape'; export type { WrappedResponse } from './wrapped'; export type { ContractResponse } from './contract';\n",
    "apps/web/src/api/auctions/shape.ts": "type Shape = { id: string }; export type AuctionResponse = Shape;\n",
    "apps/web/src/api/auctions/wrapped.ts": "type Envelope<T> = { data: T }; type LocalDto = { id: string }; export type WrappedResponse = Envelope<LocalDto>;\n",
    "apps/web/src/api/auctions/contract.ts": "import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions'; export type ContractResponse = AuctionV1Response;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "manual-api-response").length, 2);
});
