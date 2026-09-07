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

test("contracts의 src/api 경로를 Web API resource로 오인하지 않는다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "import { operation } from '../../../../../packages/contracts/src/api/v1/auctions'; void operation;\n",
    "packages/contracts/src/api/v1/auctions/index.ts": "export const operation = {};\n",
  });

  assert.deepEqual(report.unmatchedFindings, []);
});

test("browser transport의 server 전용 import와 server transport의 browser import를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/_transport/browser-request.ts": "export { serverRequest } from './server-request.server';\n",
    "apps/web/src/api/_transport/request-contract.ts": "import { serverRequest } from './server-request.server'; void serverRequest;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "import { browserRequest } from './browser-request'; void browserRequest;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "transport-runtime-cross-import").length, 3);
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

test("canonical 화면의 임의 motion과 shared control의 업무 의존을 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/shared/ui/button.tsx": [
      "import { authClient } from '@/shared/lib/auth-client';",
      "import { captureException } from '@sentry/nextjs';",
      "export const className = 'transition-all duration-200';",
      "void authClient; void captureException;",
    ].join("\n"),
    "apps/web/src/app/(workspace)/auctions/action.tsx":
      "export const className = 'active:scale-95 active:translate-y-px';\n",
  });

  assert.deepEqual(rules(report).sort(), [
    "motion-duration-literal",
    "motion-local-press",
    "motion-transition-all",
    "shared-control-responsibility",
  ].sort());
  assert.equal(
    report.unmatchedFindings.filter(
      (finding) => finding.rule === "shared-control-responsibility",
    ).length,
    2,
  );
});

test("공통 primitive의 token 기반 press motion은 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/shared/ui/button.tsx": [
      "import { Button } from '@base-ui/react/button';",
      "export const className = [",
      "  'transition-[color,background-color,border-color,opacity,transform]',",
      "  'duration-[var(--motion-duration-state)]',",
      "  'data-[interaction=press]:active:not-aria-[haspopup]:translate-y-px',",
      "  'motion-reduce:transform-none',",
      "].join(' ');",
      "void Button;",
    ].join("\n"),
  });

  assert.deepEqual(report.unmatchedFindings, []);
});

test("loading route의 직접 Skeleton 조립과 범용 PageContainer loading 상태를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/app/(workspace)/auctions/loading.tsx": [
      "import { Skeleton } from '@/shared/ui/skeleton';",
      "export default function Loading() {",
      "  return <><Skeleton /><div className='animate-pulse' /></>;",
      "}",
    ].join("\n"),
    "apps/web/src/components/layout/page-container.tsx": [
      "export function PageContainer({ isLoading, children }) {",
      "  return isLoading ? <div>loading</div> : children;",
      "}",
    ].join("\n"),
  });

  assert.deepEqual(rules(report).sort(), [
    "page-container-loading-state",
    "route-loading-boundary",
  ]);
});

test("loading route가 sibling ScreenSkeleton 하나만 반환하면 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/app/(workspace)/auctions/loading.tsx": [
      "import { AuctionScreenSkeleton } from './_ui/auction-screen-skeleton';",
      "export default function Loading() {",
      "  return <AuctionScreenSkeleton />;",
      "}",
    ].join("\n"),
    "apps/web/src/app/(workspace)/auctions/_ui/auction-screen-skeleton.tsx":
      "export function AuctionScreenSkeleton() { return <main aria-busy='true' />; }\n",
  });

  assert.deepEqual(report.unmatchedFindings, []);
});

test("root loading route도 Client Component이면 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/app/loading.tsx": [
      "'use client';",
      "import { RootScreenSkeleton } from './_ui/root-screen-skeleton';",
      "export default function Loading() { return <RootScreenSkeleton />; }",
    ].join("\n"),
    "apps/web/src/app/_ui/root-screen-skeleton.tsx":
      "export function RootScreenSkeleton() { return <main aria-busy='true' />; }\n",
  });

  assert.deepEqual(rules(report), ["route-loading-boundary"]);
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

test("한국어 module 책임 주석은 source 전체 legacy fingerprint를 바꾸지 않는다", async () => {
  const body = Array.from({ length: 300 }, (_, index) => `export const page${index} = ${index};`).join("\n");
  const subject = fixture({
    "apps/web/src/app/page.tsx": `'use client';\n${body}\n`,
  });
  try {
    const initial = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    writeFileSync(subject.baselinePath, `${JSON.stringify({ version: 1, entries: initial.findings.map((finding) => ({ ...finding, reason: "legacy", owner: "EAT-9", splitTrigger: "migrate" })) }, null, 2)}\n`);
    writeFileSync(path.join(subject.sourceRoot, "app", "page.tsx"), `/** @module 책임: 기존 client route의 화면 책임을 설명한다. */\n'use client';\n${body}\n`);

    const commented = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });

    assert.equal(commented.baselineFailures.length, 0);
    assert.equal(commented.unmatchedFindings.length, 0);
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

test("transport ownership은 exact resource와 transport path만 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "import { browserRequest } from '@/api/_transport/browser-request'; void browserRequest;\n",
    "apps/web/src/api/auctions/server.ts": "import { serverRequest } from '@/api/_transport/server-request.server'; void serverRequest;\n",
    "apps/web/src/api/auctions/operation.ts": "import type { ContractRequest } from '@/api/_transport/request-contract'; export type Request = ContractRequest;\n",
    "apps/web/src/api/auctions/internal/index.ts": "import { browserRequest } from '@/api/_transport/browser-request'; void browserRequest;\n",
    "apps/web/src/api/auctions/internal/server.ts": "import { serverRequest } from '@/api/_transport/server-request.server'; void serverRequest;\n",
    "apps/web/src/api/auctions/nested.ts": "import { browserRequest } from '@/api/_transport/internal/browser-request'; void browserRequest;\n",
    "apps/web/src/api/_transport/browser-request.ts": "export const browserRequest = () => undefined;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "export const serverRequest = () => undefined;\n",
    "apps/web/src/api/_transport/request-contract.ts": "export interface ContractRequest {}\n",
    "apps/web/src/api/_transport/internal/browser-request.ts": "export const browserRequest = () => undefined;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 3);
});

test("overridden Response decoder도 receiver inheritance로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "class OverrideResponse extends Response { json() { return Promise.resolve({}); } text() { return Promise.resolve(''); } } const parser = { text: () => '' }; export function load(response: OverrideResponse) { parser.text(); return [response.json(), response.text()]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 1);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 1);
});

test("endpoint authority는 repo-root prefix와 template static path만 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/vendor/packages/contracts/src/api/fake.ts": "export const fake = '/api/v9/fake';\n",
    "apps/web/src/api/auctions/get.ts": "export const dynamic = (id: string) => `/api/v9/auctions/${id}`; export const staticPath = `/api/v8/auctions`;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 3);
});

test("manual DTO graph은 local compound shape를 거부하고 resolved contract type은 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export type { InterfaceResponse } from './interface'; export type { MappedResponse } from './mapped'; export type { TupleResponse } from './tuple'; export type { ArrayResponse } from './array'; export type { UnionResponse } from './union'; export type { IntersectionResponse } from './intersection'; export type { IdentityResponse } from './identity'; export type { ContractResponse } from './contract';\n",
    "apps/web/src/api/auctions/interface.ts": "interface Local { id: string } export type InterfaceResponse = Local;\n",
    "apps/web/src/api/auctions/mapped.ts": "type Map<T> = { [K in keyof T]: T[K] }; type Local = { id: string }; export type MappedResponse = Map<Local>;\n",
    "apps/web/src/api/auctions/tuple.ts": "export type TupleResponse = [string, { id: string }];\n",
    "apps/web/src/api/auctions/array.ts": "type Local = { id: string }; export type ArrayResponse = Local[];\n",
    "apps/web/src/api/auctions/union.ts": "type Local = { id: string }; export type UnionResponse = Local | null;\n",
    "apps/web/src/api/auctions/intersection.ts": "type Local = { id: string }; export type IntersectionResponse = Local & { name: string };\n",
    "apps/web/src/api/auctions/identity.ts": "type Identity<T> = T; type Local = { id: string }; export type IdentityResponse = Identity<Local>;\n",
    "apps/web/src/api/auctions/contract.ts": "import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions'; export type ContractResponse = AuctionV1Response;\n",
    "node_modules/@eatbid/contracts/package.json": "{\"name\":\"@eatbid/contracts\",\"exports\":{\"./api/v1/auctions\":\"./api/v1/auctions.d.ts\"}}\n",
    "node_modules/@eatbid/contracts/api/v1/auctions.d.ts": "export interface AuctionV1Response { id: string }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "manual-api-response").length, 7);
});

test("duplicate baseline은 member subset cleanup을 허용하고 content 또는 member 증가를 거부한다", async () => {
  const duplicate = (prefix) => Array.from({ length: 10 }, (_, index) => `export const ${prefix}${index} = '${"x".repeat(16)}';`).join("\n");
  const subject = fixture({
    "apps/web/src/shared/a.ts": duplicate("a"),
    "apps/web/src/shared/b.ts": duplicate("a"),
    "apps/web/src/shared/c.ts": duplicate("a"),
  });
  try {
    const initial = await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath });
    writeFileSync(subject.baselinePath, `${JSON.stringify({ version: 1, entries: initial.findings.map((finding) => ({ ...finding, reason: "legacy", owner: "EAT-9", splitTrigger: "migrate" })) }, null, 2)}\n`);
    writeFileSync(path.join(subject.sourceRoot, "shared", "a.ts"), "export const removed = 1;\n");
    assert.equal((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.length, 0);

    writeFileSync(path.join(subject.sourceRoot, "shared", "a.ts"), duplicate("a"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "c.ts"), "export const removed = 3;\n");
    assert.equal((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.length, 0);

    writeFileSync(path.join(subject.sourceRoot, "shared", "c.ts"), duplicate("changed"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "a.ts"), duplicate("changed"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "b.ts"), duplicate("changed"));
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /fingerprint drift/);

    writeFileSync(path.join(subject.sourceRoot, "shared", "a.ts"), duplicate("a"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "b.ts"), duplicate("a"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "c.ts"), duplicate("a"));
    writeFileSync(path.join(subject.sourceRoot, "shared", "d.ts"), duplicate("a"));
    assert.match((await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baselinePath: subject.baselinePath })).baselineFailures.join("\n"), /membership increase/);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test("server transport는 canonical server-request.server.ts만 resource server에 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/server.ts": "import { serverRequest } from '@/api/_transport/server-request.server'; void serverRequest;\n",
    "apps/web/src/api/orders/server.ts": "import { serverRequest } from '@/api/_transport/server-request'; void serverRequest;\n",
    "apps/web/src/api/orders/index.ts": "import { serverRequest } from '@/api/_transport/server-request.server'; void serverRequest;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "export const serverRequest = () => undefined;\n",
    "apps/web/src/api/_transport/server-request.ts": "export const serverRequest = () => undefined;\n",
  });

  assert.deepEqual(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").map((finding) => finding.path).sort(), [
    "apps/web/src/api/orders/index.ts",
    "apps/web/src/api/orders/server.ts",
  ]);
});

test("dynamic import transport는 resource와 외부 consumer에서 거부하고 contract import은 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export const browser = () => import('@/api/_transport/browser-request');\n",
    "apps/web/src/api/auctions/operation.ts": "export const contract = () => import('@/api/_transport/request-contract');\n",
    "apps/web/src/capabilities/search/view.ts": "export const bypass = () => import('@/api/_transport/browser-request');\n",
    "apps/web/src/api/auctions/contract.ts": "export const operation = () => import('@eatbid/contracts/api/v1/auctions');\n",
    "apps/web/src/api/_transport/browser-request.ts": "export const browserRequest = () => undefined;\n",
    "apps/web/src/api/_transport/request-contract.ts": "export interface ContractRequest {}\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 3);
});

test("resolved TypeScript contract와 builtin object utility DTO provenance를 구분한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export type { LiveResponse } from './live-contract'; export type { RecordResponse } from './record'; export type { PromiseResponse } from './promise'; export type { DateResponse } from './date';\n",
    "apps/web/src/api/auctions/live-contract.ts": "import type { LiveAuctionResponse } from '@eatbid/contracts/api/v1/live'; export type LiveResponse = LiveAuctionResponse;\n",
    "apps/web/src/api/auctions/record.ts": "export type RecordResponse = Record<string, string>;\n",
    "apps/web/src/api/auctions/promise.ts": "type Local = { id: string }; export type PromiseResponse = Promise<Local>;\n",
    "apps/web/src/api/auctions/date.ts": "export type DateResponse = Date;\n",
    "node_modules/@eatbid/contracts/package.json": "{\"name\":\"@eatbid/contracts\",\"exports\":{\"./api/v1/live\":\"./api/v1/live.ts\"}}\n",
    "node_modules/@eatbid/contracts/api/v1/live.ts": "export interface LiveAuctionResponse { id: string }\n",
  });

  assert.deepEqual(report.unmatchedFindings.filter((finding) => finding.rule === "manual-api-response").map((finding) => finding.path).sort(), [
    "apps/web/src/api/auctions/promise.ts",
    "apps/web/src/api/auctions/record.ts",
  ]);
});

test("endpoint template의 static version expression만 canonical literal로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export const numeric = `/api/v${1}/auctions`; export const string = `/api/${'v1'}/auctions`; export const dynamic = (version: string) => `/api/v${version}/auctions`; export const unrelated = (value: string) => `prefix/${value}`;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 2);
});

test("Response bracket decoder와 prototype call apply bind bypass를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "class CustomResponse extends Response {} const parser = { ['json']: () => 1, text: () => 2 }; export function load(response: CustomResponse | (Response & {}), value: unknown) { parser['json'](); parser.text(); return [response['json'](), Response.prototype.text.call(response), Response.prototype.json.apply(response), Response.prototype.text.bind(response)(), Response.prototype.text.call(value)]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 2);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 2);
});

test("dynamic transport specifier의 const template concat unknown segment를 fail-closed로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const browser = 'browser-request' as const; const segment = 'server-request.server' as const; declare const unknown: string; export const template = () => import(`@/api/_transport/${browser}`); export const concat = () => import('@/api/_transport/' + segment); export const partial = () => import(`@/api/_transport/${unknown}`); export const contract = () => import('@eatbid/contracts/api/v1/auctions');\n",
    "apps/web/src/api/_transport/browser-request.ts": "export const browserRequest = () => undefined;\n",
    "apps/web/src/api/_transport/server-request.server.ts": "export const serverRequest = () => undefined;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 3);
});

test("manual DTO provenance는 local type query class callable parameter와 object builtin을 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export type { TypeofResponse } from './typeof'; export type { ClassResponse } from './class'; export type { CallableResponse } from './callable'; export type { ParameterResponse } from './parameter'; export type { IndexedResponse } from './indexed'; export type { KeyofResponse } from './keyof'; export type { ConditionalResponse } from './conditional'; export type { UrlResponse } from './url'; export type { MapResponse } from './map'; export type { SetResponse } from './set'; export type { NativeResponse } from './native-response'; export type { PrimitiveResponse } from './primitive'; export type { DateResponse } from './date'; export type { ContractResponse } from './contract';\n",
    "apps/web/src/api/auctions/typeof.ts": "const local = { id: 'a' }; export type TypeofResponse = typeof local;\n",
    "apps/web/src/api/auctions/class.ts": "class Local { id = 'a'; } export type ClassResponse = Local;\n",
    "apps/web/src/api/auctions/callable.ts": "type Callable = () => { id: string }; export type CallableResponse = Callable;\n",
    "apps/web/src/api/auctions/parameter.ts": "export type ParameterResponse<T> = T;\n",
    "apps/web/src/api/auctions/indexed.ts": "type Local = { id: string }; export type IndexedResponse = Local[keyof Local];\n",
    "apps/web/src/api/auctions/keyof.ts": "type Local = { id: string }; export type KeyofResponse = keyof Local;\n",
    "apps/web/src/api/auctions/conditional.ts": "type Local = { id: string }; type PickLocal<T> = T extends string ? Local : Date; export type ConditionalResponse = PickLocal<string>;\n",
    "apps/web/src/api/auctions/url.ts": "export type UrlResponse = URL;\n",
    "apps/web/src/api/auctions/map.ts": "export type MapResponse = Map<string, string>;\n",
    "apps/web/src/api/auctions/set.ts": "export type SetResponse = Set<string>;\n",
    "apps/web/src/api/auctions/native-response.ts": "export type NativeResponse = Response;\n",
    "apps/web/src/api/auctions/primitive.ts": "export type PrimitiveResponse = string;\n",
    "apps/web/src/api/auctions/date.ts": "export type DateResponse = Date;\n",
    "apps/web/src/api/auctions/contract.ts": "import type { AuctionResponse } from '@eatbid/contracts/api/v1/auctions'; export type ContractResponse = AuctionResponse;\n",
    "node_modules/@eatbid/contracts/package.json": "{\"name\":\"@eatbid/contracts\",\"exports\":{\"./api/v1/auctions\":\"./api/v1/auctions.ts\"}}\n",
    "node_modules/@eatbid/contracts/api/v1/auctions.ts": "export interface AuctionResponse { id: string }\n",
  });

  assert.deepEqual(report.unmatchedFindings.filter((finding) => finding.rule === "manual-api-response").map((finding) => finding.path).sort(), [
    "apps/web/src/api/auctions/callable.ts", "apps/web/src/api/auctions/class.ts", "apps/web/src/api/auctions/conditional.ts", "apps/web/src/api/auctions/indexed.ts", "apps/web/src/api/auctions/keyof.ts", "apps/web/src/api/auctions/map.ts", "apps/web/src/api/auctions/native-response.ts", "apps/web/src/api/auctions/parameter.ts", "apps/web/src/api/auctions/set.ts", "apps/web/src/api/auctions/typeof.ts", "apps/web/src/api/auctions/url.ts",
  ]);
});

test("endpoint static evaluator는 const assertion satisfies concat과 arithmetic span을 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const one = 1 as const; const base = '/api/v' satisfies string; export const asserted = `${base}${one}/auctions`; export const concat = '/api/' + ('v2' as const) + '/auctions'; export const arithmetic = `/api/v${1 + 2}/auctions`; export const unknown = (part: string) => `/api/v${part}/auctions`;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 3);
});

test("Response syntax normalization은 wrapped const key global prototype와 bracket apply를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const key = 'json' as const; const parser = { json: () => 1 }; export function load(response: Response, value: unknown) { parser[key](); return [(response['json'])(), response[key](), (Response.prototype.json).call(response), globalThis.Response.prototype.text.call(response), Response.prototype.json['apply'](response), (Response.prototype.text.bind(response))(), Response.prototype.text.call(value)]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 4);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 2);
});

test("static evaluator는 같은 const 재사용을 허용하고 실제 순환만 중단한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const version = 1 as const; export const repeated = `/api/v${version + version}/auctions`; const cycleA = cycleB; const cycleB = cycleA; export const cyclic = `/api/v${cycleA}/auctions`;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 1);
});

test("import type DTO는 local shape를 거부하고 contract authority를 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/index.ts": "export type { LocalResponse, ContractResponse } from './responses';\n",
    "apps/web/src/api/auctions/responses.ts": "export type LocalResponse = import('./shape').LocalShape; export type ContractResponse = import('@eatbid/contracts/api/v1/auctions').AuctionResponse;\n",
    "apps/web/src/api/auctions/literal.ts": "export const endpoint = '/api/v1/auctions';\n",
    "apps/web/src/api/auctions/shape.ts": "export interface LocalShape { id: string }\n",
    "node_modules/@eatbid/contracts/package.json": "{\"name\":\"@eatbid/contracts\",\"exports\":{\"./api/v1/auctions\":\"./api/v1/auctions.d.ts\"}}\n",
    "node_modules/@eatbid/contracts/api/v1/auctions.d.ts": "export interface AuctionResponse { id: string }\n",
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["api-endpoint-literal", "apps/web/src/api/auctions/literal.ts"],
    ["manual-api-response", "apps/web/src/api/auctions/responses.ts"],
  ]);
});

test("Response instance decoder의 call apply bind 우회를 거부하고 parser는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const key = 'json' as const; const parser = { json: () => 1, text: () => 2 }; export function load(response: Response) { parser.json.call(parser); parser.text.apply(parser); return [response[key]['call'](response), (response.text).apply(response), (response.blob.bind(response))()]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-json").length, 1);
  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "unchecked-response-body").length, 2);
});

test("unresolved dynamic transport fallback은 Web transport root에만 적용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "declare const segment: string; export const web = () => import(`@/api/_transport/${segment}`); export const vendor = () => import(`@vendor/api/_transport/${segment}`); export const shared = () => import(`@/shared/api/_transport/${segment}`);\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "resource-transport-import").length, 1);
});

test("중첩 endpoint template은 outermost finding 하나만 보고한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const version = 1 as const; export const path = `prefix-${`/api/v${version}/auctions`}`;\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "api-endpoint-literal").length, 1);
});

test("wrapped bracket global fetch는 거부하고 local shadow는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "const key = 'fetch' as const; export function load() { return [(window['fetch'])('/one'), globalThis[key]('/two'), (globalThis.fetch)('/three'), (fetch)('/four')]; }\n",
    "apps/web/src/shared/local.ts": "const key = 'fetch' as const; const fetch = (value: string) => value; const window = { fetch: (value: string) => value }; export const safe = () => [(fetch)('one'), window[key]('two')];\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 4);
});

test("call bind comma wrapper의 전역 fetch만 거부하고 local shadow와 임의 객체는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export function load() { return [window['fetch'].call(window, '/one'), globalThis.fetch.bind(globalThis)('/two'), (0, fetch)('/three')]; }\n",
    "apps/web/src/shared/local.ts": "const fetch = (value: string) => value; const client = { fetch: (value: string) => value }; export function safe(window: { fetch(value: string): string }, globalThis: { fetch(value: string): string }) { return [window['fetch'].call(window, 'one'), globalThis.fetch.bind(globalThis)('two'), (0, fetch)('three'), client.fetch.call(client, 'four')]; }\n",
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
  ]);
});

test("중첩 comma bind call 조합의 전역 fetch만 재귀적으로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export function load() { return [(0, window.fetch).call(window, '/one'), (0, fetch.bind(globalThis))('/two'), globalThis.fetch.bind(globalThis).call(undefined, '/three'), (0, (0, (0, globalThis.fetch)))('/four')]; }\n",
    "apps/web/src/shared/local.ts": "const fetch = (value: string) => value; export function safe(window: { fetch(value: string): string }, globalThis: { fetch(value: string): string }) { return [(0, window.fetch).call(window, 'one'), (0, fetch.bind(globalThis))('two'), globalThis.fetch.bind(globalThis).call(undefined, 'three'), (0, (0, (0, fetch)))('four')]; }\n",
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
  ]);
});

test("call apply bind 다중 조합은 global fetch origin일 때만 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export function load() { return [window.fetch.call.bind(window.fetch)(window, '/one'), globalThis.fetch.apply.bind(globalThis.fetch)(globalThis, ['/two']), globalThis.fetch.bind(globalThis).apply(undefined, ['/three']), globalThis.fetch.call.call(globalThis.fetch, globalThis, '/four')]; }\n",
    "apps/web/src/shared/local.ts": "const fetch = (value: string) => value; const client = { run: (value: string) => value }; export function safe(window: { fetch(value: string): string }, globalThis: { fetch(value: string): string }) { return [window.fetch.call.bind(window.fetch)(window, 'one'), fetch.apply.bind(fetch)(globalThis, ['two']), globalThis.fetch.bind(globalThis).apply(undefined, ['three']), fetch.call.call(fetch, globalThis, 'four'), client.run.call.bind(client.run)(client, 'five')]; }\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 4);
  assert.ok(report.unmatchedFindings.every((finding) => finding.path === "apps/web/src/api/auctions/get.ts"));
});

test("40단계 comma wrapper는 global fetch를 fail closed로 막고 local shadow는 허용한다", async () => {
  const wrap = (expression) => Array.from({ length: 40 }).reduce((current) => `(0, ${current})`, expression);
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": `export const load = () => ${wrap("globalThis.fetch")}('/deep');\n`,
    "apps/web/src/shared/local.ts": `const fetch = (value: string) => value; export const safe = () => ${wrap("fetch")}('deep');\n`,
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
  ]);
});

test("fetch 반환값 method chain은 원 fetch 호출 하나만 보고한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": "export const load = () => fetch('/auction').then((response) => response);\n",
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 1);
});

test("bind를 call apply로 역호출한 전역 fetch만 재귀적으로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": [
      "export function load() {",
      "  return [",
      "    globalThis.fetch.bind.call(globalThis.fetch, globalThis)('/one'),",
      "    globalThis.fetch.bind.apply(globalThis.fetch, [globalThis])('/two'),",
      "    globalThis.fetch.bind.call.call(globalThis.fetch.bind, globalThis.fetch, globalThis)('/three'),",
      "    globalThis.fetch.bind.apply.call(globalThis.fetch.bind, globalThis.fetch, [globalThis])('/four'),",
      "  ];",
      "}",
    ].join("\n"),
    "apps/web/src/shared/local.ts": [
      "const fetch = (value: string) => value;",
      "const client = { run: (value: string) => value };",
      "export function safe(globalThis: { fetch(value: string): string }) {",
      "  return [",
      "    globalThis.fetch.bind.call(globalThis.fetch, globalThis)('one'),",
      "    fetch.bind.apply(fetch, [globalThis])('two'),",
      "    fetch.bind.call.call(fetch.bind, fetch, globalThis)('three'),",
      "    client.run.bind.apply.call(client.run.bind, client.run, [client])('four'),",
      "  ];",
      "}",
    ].join("\n"),
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 4);
  assert.ok(report.unmatchedFindings.every((finding) => finding.path === "apps/web/src/api/auctions/get.ts"));
});

test("120단계 callable 경계는 전역 fetch 근거만 fail closed로 거부한다", async () => {
  const wrap = (expression) => Array.from({ length: 120 }).reduce((current) => `(0, ${current})`, expression);
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": `export const load = () => ${wrap("globalThis.fetch.bind.call(globalThis.fetch, globalThis)")}('/deep');\n`,
    "apps/web/src/shared/local.ts": [
      "const fetch = (value: string) => value;",
      "const client = { run: (value: string) => value };",
      `export const local = () => ${wrap("fetch.bind.call(fetch, globalThis)")}('deep');`,
      `export const arbitrary = () => ${wrap("client.run.bind.call(client.run, client)")}('deep');`,
      `export const fetchOnlyAsThis = () => ${wrap("client.run.bind.call(client.run, globalThis.fetch)")}('deep');`,
    ].join("\n"),
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["raw-fetch", "apps/web/src/api/auctions/get.ts"],
  ]);
});

test("spread tuple로 bind를 역호출해도 전역 fetch만 한 번 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": [
      "export function load() {",
      "  return [",
      "    globalThis.fetch.bind.call(...[globalThis.fetch, globalThis])('/one'),",
      "    globalThis.fetch.bind.apply(...[globalThis.fetch, [globalThis]])('/two'),",
      "    Function.prototype.bind.call(...[globalThis.fetch, globalThis])('/three'),",
      "    Function.prototype.bind.apply(...[globalThis.fetch, [globalThis]])('/four'),",
      "  ];",
      "}",
    ].join("\n"),
    "apps/web/src/shared/local.ts": [
      "const fetch = (value: string) => value;",
      "const client = { run: (value: string) => value };",
      "const Function = { prototype: { bind: (value: unknown) => () => value } };",
      "export function safe(globalThis: { fetch(value: string): string }) {",
      "  return [",
      "    globalThis.fetch.bind.call(...[globalThis.fetch, globalThis])('one'),",
      "    fetch.bind.apply(...[fetch, [globalThis]])('two'),",
      "    Function.prototype.bind.call(...[Function.prototype.bind, client])('three'),",
      "    client.run.bind.apply(...[client.run, [client]])('four'),",
      "  ];",
      "}",
    ].join("\n"),
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 4);
  assert.ok(report.unmatchedFindings.every((finding) => finding.path === "apps/web/src/api/auctions/get.ts"));
});

test("spread 모양이 불명확하면 DOM fetch 근거만 fail closed로 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/get.ts": [
      "declare const runtimeArguments: unknown[];",
      "declare const runtimeTail: unknown[];",
      "export function load() {",
      "  return [",
      "    globalThis.fetch.bind.call(...runtimeArguments)('/one'),",
      "    globalThis.fetch.bind.apply(...runtimeArguments)('/two'),",
      "    Function.prototype.bind.call(...[globalThis.fetch, ...runtimeTail])('/three'),",
      "    Function.prototype.bind.apply(...[globalThis.fetch, ...runtimeTail])('/four'),",
      "  ];",
      "}",
    ].join("\n"),
    "apps/web/src/shared/local.ts": [
      "declare const runtimeArguments: unknown[];",
      "const fetch = (value: string) => value;",
      "const client = { run: (value: string) => value };",
      "const Function = { prototype: { bind: (value: unknown) => () => value } };",
      "export const local = () => fetch.bind.call(...runtimeArguments)('one');",
      "export const arbitrary = () => client.run.bind.apply(...runtimeArguments)('two');",
      "export const shadow = () => Function.prototype.bind.call(...runtimeArguments)('three');",
      "export const unrelatedThis = () => client.run.bind.call(...[client.run, globalThis.fetch])('four');",
    ].join("\n"),
  });

  assert.equal(report.unmatchedFindings.filter((finding) => finding.rule === "raw-fetch").length, 4);
  assert.ok(report.unmatchedFindings.every((finding) => finding.path === "apps/web/src/api/auctions/get.ts"));
});

test("불명확한 spread 앞의 bind 대상 위치를 보존해 thisArg와 boundArg의 fetch는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/shared/local.ts": [
      "declare const runtimeTail: unknown[];",
      "const client = { run: (value: string) => value };",
      "export const safeCall = () => Function.prototype.bind.call(",
      "  ...[client.run, globalThis.fetch, ...runtimeTail]",
      ")('safe-call');",
      "export const safeApply = () => Function.prototype.bind.apply(",
      "  ...[client.run, [globalThis.fetch], ...runtimeTail]",
      ")('safe-apply');",
    ].join("\n"),
  });

  assert.deepEqual(report.unmatchedFindings, []);
});

test("신규 층의 legacy 폴더 역참조를 거부하고 legacy 폴더끼리와 shared 참조는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/shell/layout/shell.tsx": "import Header from '@/components/layout/header'; export const Shell = () => Header;\n",
    "apps/web/src/shell/theme/toggle.tsx": "import { Kbd } from '../../components/ui/kbd'; export const toggle = Kbd;\n",
    "apps/web/src/app/(workspace)/auctions/page.tsx": "import { deadline } from '@/lib/deadline'; export default function Page() { return deadline; }\n",
    "apps/web/src/routing/auction.ts": "import type { Route } from '@/types/route'; export const route = (value: Route) => value;\n",
    "apps/web/src/shell/layout/controls.tsx": "export { LegacyHeaderControls } from '@/app/dashboard/_ui/legacy-header-controls';\n",
    "apps/web/src/shared/lib/deadline-type.ts": "export type Deadline = typeof import('@/lib/deadline');\n",
    "apps/web/src/shared/ui/card.tsx": "import { cn } from '@/shared/lib/cn'; export const card = cn;\n",
    "apps/web/src/app/dashboard/_ui/legacy-header-controls.tsx": "export const LegacyHeaderControls = () => null;\n",
    "apps/web/src/app/dashboard/layout.tsx": "import { LegacyHeaderControls } from './_ui/legacy-header-controls'; export default function Layout() { return LegacyHeaderControls(); }\n",
    "apps/web/src/components/layout/page.tsx": "import { deadline } from '@/lib/deadline'; export const page = deadline;\n",
    "apps/web/src/components/layout/header.tsx": "export default function Header() { return null; }\n",
    "apps/web/src/components/ui/kbd.tsx": "export const Kbd = () => null;\n",
    "apps/web/src/lib/deadline.ts": "export const deadline = 1;\n",
    "apps/web/src/types/route.ts": "export type Route = string;\n",
    "apps/web/src/shared/lib/cn.ts": "export const cn = (value: string) => value;\n",
  });

  const legacy = report.unmatchedFindings.filter((finding) => finding.rule === "legacy-import");
  assert.deepEqual(legacy.map((finding) => finding.path).sort(), [
    "apps/web/src/app/(workspace)/auctions/page.tsx",
    "apps/web/src/routing/auction.ts",
    "apps/web/src/shared/lib/deadline-type.ts",
    "apps/web/src/shell/layout/controls.tsx",
    "apps/web/src/shell/layout/shell.tsx",
    "apps/web/src/shell/theme/toggle.tsx",
  ]);
});

test("routing 층의 legacy dashboard 경로와 hooks 디렉터리 신규 파일을 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/routing/analysis.ts": "export const analysis = (id: string) => `/dashboard/analysis/${id}`;\n",
    "apps/web/src/routing/auction.ts": "export const auction = (id: string) => `/auctions/${id}`;\n",
    "apps/web/src/routing/shim.ts": "export { analysis as legacyAnalysis } from '../app/dashboard/analysis/_lib/analysis-route';\n",
    "apps/web/src/app/dashboard/analysis/_lib/analysis-route.ts": "export const analysis = (id: string) => `/dashboard/analysis/${id}`;\nexport const plain = '/dashboard/analysis';\n",
    "apps/web/src/app/dashboard/today/_ui/link.tsx": "export const href = '/dashboard/today';\n",
    "apps/web/src/hooks/new-hook.ts": "export const useNew = () => 1;\n",
    "apps/web/src/shared/lib/hooks/use-generic.ts": "export const useGeneric = () => 1;\n",
  });

  const identity = report.unmatchedFindings.filter((finding) => finding.rule === "legacy-identity-route");
  assert.deepEqual(identity.map((finding) => finding.path).sort(), [
    "apps/web/src/app/dashboard/analysis/_lib/analysis-route.ts",
    "apps/web/src/app/dashboard/analysis/_lib/analysis-route.ts",
    "apps/web/src/routing/analysis.ts",
    "apps/web/src/routing/shim.ts",
  ]);
  assert.deepEqual(
    report.unmatchedFindings.filter((finding) => finding.rule === "legacy-hooks-directory").map((finding) => finding.path),
    ["apps/web/src/hooks/new-hook.ts"],
  );
});

test("use cache는 api resource server entry 밖과 요청별 입력 동거를 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/server.ts": "export async function read() {\n  'use cache';\n  return 1;\n}\n",
    "apps/web/src/api/auctions/get-auction.ts": "export async function leaked() {\n  'use cache';\n  return 2;\n}\n",
    "apps/web/src/app/(workspace)/auctions/page.tsx": "export default async function Page() {\n  'use cache';\n  return null;\n}\n",
    "apps/web/src/api/organizations/server.ts": "import { cookies } from 'next/headers';\nexport async function read() {\n  'use cache';\n  return cookies();\n}\n",
  });

  assert.deepEqual(
    report.unmatchedFindings
      .filter((finding) => finding.rule === "use-cache-placement")
      .map((finding) => finding.path)
      .sort(),
    ["apps/web/src/api/auctions/get-auction.ts", "apps/web/src/app/(workspace)/auctions/page.tsx"],
  );
  assert.deepEqual(
    report.unmatchedFindings
      .filter((finding) => finding.rule === "use-cache-user-data")
      .map((finding) => finding.path),
    ["apps/web/src/api/organizations/server.ts"],
  );
});

test("use cache 없는 파일의 요청별 입력과 server entry의 캐시 경계는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/api/auctions/server.ts": "export async function read(input: { auctionId: string }) {\n  'use cache';\n  return input.auctionId;\n}\n",
    "apps/web/src/app/(workspace)/layout.tsx": "import { cookies } from 'next/headers';\nexport default async function Layout() {\n  return cookies();\n}\n",
  });

  assert.deepEqual(rules(report).filter((rule) => rule.startsWith("use-cache")), []);
});

test("legacy lib의 client 업무 계산 export는 삭제 전용 ledger 대상으로 보고한다", async () => {
  const report = await inspect({
    "apps/web/src/lib/band.ts": "export function pickBand(rate: number) { return rate * 100; }\nexport const floor = (value: number) => Math.floor(value);\nfunction hidden(value: number) { return value / 2; }\nexport { hidden };\nconst internal = 1; void internal;\ntype Local = { hi: number };\ntype Other = { lo: number };\nexport { type Local };\nexport type { Other };\nexport {};\nexport type Band = { lo: number };\n",
    "apps/web/src/lib/deadline.ts": "function mixedRuntime(value: number) { return value + 1; }\ntype MixedType = number;\nexport { mixedRuntime, type MixedType };\n",
    "apps/web/src/lib/utils.ts": "export function cn(value: string) { return value; }\n",
    "apps/web/src/lib/__tests__/band.test.ts": "export const fixture = 1;\n",
  });

  const calculations = report.unmatchedFindings.filter((finding) => finding.rule === "client-domain-calculation");
  assert.deepEqual(
    calculations.map((finding) => `${finding.path.split("/").at(-1)}:${finding.kind}`).sort(),
    ["band.ts:ExportDeclaration", "band.ts:FunctionDeclaration", "band.ts:VariableStatement", "deadline.ts:ExportDeclaration"],
  );
  assert.ok(calculations.some((finding) => finding.reason.includes("pickBand")));
  assert.ok(calculations.some((finding) => finding.reason.includes("mixedRuntime")));
  assert.ok(calculations.every((finding) => !/Local|Other|\(\)/.test(finding.reason)));
  // 계산 ledger 파일은 export 단위로만 추적해 파일 전체 fingerprint와 겹치지 않는다.
  assert.deepEqual(
    report.unmatchedFindings.filter((finding) => finding.rule === "legacy-lib-directory").map((finding) => finding.path),
    ["apps/web/src/lib/utils.ts"],
  );
});

test("서버 모듈이 use client 모듈의 상수·함수·hook을 import하면 거부하고 이름을 안내한다", async () => {
  const report = await inspect({
    "apps/web/src/capabilities/decision/history-table.tsx": "'use client';\nexport const SHOWN_ROWS = 5;\nexport function useRows() { return SHOWN_ROWS; }\nexport function HistoryTable() { return null; }\n",
    "apps/web/src/capabilities/decision/decision-screen.tsx": "import { HistoryTable, SHOWN_ROWS, useRows } from './history-table';\nvoid HistoryTable; void SHOWN_ROWS; void useRows;\n",
    "apps/web/src/capabilities/decision/namespace-consumer.tsx": "import * as History from './history-table';\nvoid History;\n",
  });

  const findings = report.unmatchedFindings.filter((finding) => finding.rule === "client-value-export-import");
  assert.deepEqual(findings.map((finding) => finding.path).sort(), [
    "apps/web/src/capabilities/decision/decision-screen.tsx",
    "apps/web/src/capabilities/decision/namespace-consumer.tsx",
  ]);
  assert.match(findings[0].reason, /SHOWN_ROWS, useRows/);
  assert.match(findings[0].reason, /_model/);
  assert.doesNotMatch(findings[0].reason, /HistoryTable/);
});

test("서버 모듈의 컴포넌트·타입 import와 client 모듈 사이의 값 import는 허용한다", async () => {
  const report = await inspect({
    "apps/web/src/capabilities/decision/history-table.tsx": "'use client';\nimport { SelectPrimitive, memo } from './vendor';\nexport const SHOWN_ROWS = 5;\nexport interface Row { id: number }\nexport type RowCount = number;\nexport function HistoryTable() { return null; }\nexport const MemoTable = memo(HistoryTable);\nexport const Select = SelectPrimitive.Root;\nexport default function DefaultTable() { return null; }\n",
    "apps/web/src/capabilities/decision/vendor.ts": "export const SelectPrimitive = { Root: () => null };\nexport const memo = (component) => component;\n",
    "apps/web/src/capabilities/decision/decision-screen.tsx": "import DefaultTable, { HistoryTable, MemoTable, Select, type RowCount } from './history-table';\nimport type { Row } from './history-table';\nvoid DefaultTable; void HistoryTable; void MemoTable; void Select;\nexport const count: RowCount = 1; export const row: Row = { id: 1 };\n",
    "apps/web/src/capabilities/decision/history-toolbar.tsx": "'use client';\nimport { SHOWN_ROWS } from './history-table';\nvoid SHOWN_ROWS;\n",
  });

  assert.deepEqual(report.unmatchedFindings, []);
});

test("barrel 재수출 자체는 허용하고 barrel을 거쳐 값을 쓰는 서버 모듈만 거부한다", async () => {
  const report = await inspect({
    "apps/web/src/shell/theme/active-theme.tsx": "'use client';\nexport function useThemeConfig() { return {}; }\nexport function ThemeProvider() { return null; }\n",
    "apps/web/src/shell/index.ts": "export { useThemeConfig, ThemeProvider } from './theme/active-theme';\n",
    "apps/web/src/app/layout.tsx": "import { ThemeProvider } from '@/shell';\nvoid ThemeProvider;\n",
    "apps/web/src/app/page.tsx": "import { useThemeConfig } from '@/shell';\nvoid useThemeConfig;\n",
  });

  assert.deepEqual(report.unmatchedFindings.map((finding) => [finding.rule, finding.path]), [
    ["client-value-export-import", "apps/web/src/app/page.tsx"],
  ]);
});
