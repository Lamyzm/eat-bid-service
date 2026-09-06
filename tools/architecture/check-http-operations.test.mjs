import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectHttpOperationBoundaries } from "./check-http-operations.mjs";

function inspect(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-http-operations-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
    return inspectHttpOperationBoundaries({ repoRoot: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("semantic operation 정의와 descriptor 소비는 허용한다", () => {
  const findings = inspect({
    "packages/contracts/src/api/v1/auctions/operations.ts": [
      "import { defineOperation } from '../../operation';",
      "export const operation = defineOperation({",
      "  versioning: { kind: 'uri', prefix: 'api', version: '1' },",
      "  route: { resource: 'auctions', segments: [] },",
      "});",
    ].join("\n"),
    "apps/server/src/auction.controller.ts": "@Controller(operation.controllerPath) class AuctionController {}\n",
    "apps/web/src/api/auctions/index.ts": "import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions'; void auctionV1Operations;\n",
  });

  assert.deepEqual(findings, []);
});

test("Server와 Web의 canonical API 문자열 및 frontend ENDPOINTS mirror를 거부한다", () => {
  const findings = inspect({
    "apps/server/src/manual.ts": "export const path = '/api/v1/auctions/{auctionId}';\n",
    "apps/web/src/api/auctions/manual.ts": "export const path = `/api/v2/auctions`;\n",
    "apps/web/src/config/endpoints.ts": "export const ENDPOINTS = { auctions: '/auctions' };\n",
  });

  assert.deepEqual(findings.map((finding) => finding.rule).toSorted(), [
    "canonical-api-literal",
    "canonical-api-literal",
    "frontend-endpoints-mirror",
  ].toSorted());
});

test("Nest 수동 decorator path와 Next Route Handler를 기본 거부한다", () => {
  const findings = inspect({
    "apps/server/src/manual.controller.ts": "@Controller('auctions') class ManualController { @Get(':id') find() {} }\n",
    "apps/server/src/aliased.controller.ts": "import { Controller as C, Get as G } from '@nestjs/common'; @C('schools') class AliasedController { @G(':id') find() {} }\n",
    "apps/web/src/app/api/example/route.ts": "export const GET = () => new Response('no');\n",
  });

  assert.deepEqual(findings.map((finding) => finding.rule).toSorted(), [
    "manual-nest-route",
    "manual-nest-route",
    "manual-nest-route",
    "manual-nest-route",
    "next-public-route-handler",
  ].toSorted());
});

const webOwnedOperation = [
  "import { defineOperation } from '../operation';",
  "export const operation = defineOperation({",
  "  operationId: 'revalidateWebCache',",
  "  implementationOwner: 'web',",
  "  versioning: { kind: 'neutral' },",
  "  route: { resource: 'internal', segments: ['cache', 'revalidate'] },",
  "});",
].join("\n");

test("web 소유 operation의 semantic route와 정확히 대응하는 route handler는 허용한다", () => {
  const findings = inspect({
    "packages/contracts/src/api/internal/operations.ts": webOwnedOperation,
    "apps/web/src/app/internal/cache/revalidate/route.ts": "export const POST = () => new Response(null, { status: 204 });\n",
  });

  assert.deepEqual(findings, []);
});

test("web 소유 operation과 경로가 다른 route handler는 계속 거부한다", () => {
  const findings = inspect({
    "packages/contracts/src/api/internal/operations.ts": webOwnedOperation,
    "apps/web/src/app/internal/cache/purge/route.ts": "export const POST = () => new Response(null, { status: 204 });\n",
  });

  assert.deepEqual(findings.map((finding) => finding.rule).toSorted(), [
    "next-public-route-handler",
    "web-operation-without-handler",
  ]);
});

test("handler 없는 web 소유 operation도 실패로 남긴다", () => {
  const findings = inspect({
    "packages/contracts/src/api/internal/operations.ts": webOwnedOperation,
  });

  assert.deepEqual(findings.map((finding) => finding.rule), ["web-operation-without-handler"]);
  assert.equal(findings[0].path, "apps/web/src/app/internal/cache/revalidate/route.ts");
});

test("server 소유 operation은 route handler 예외를 만들지 않는다", () => {
  const findings = inspect({
    "packages/contracts/src/api/v1/auctions/operations.ts": [
      "import { defineOperation, pathParameter } from '../../../operation';",
      "export const operation = defineOperation({",
      "  operationId: 'findAuction',",
      "  implementationOwner: 'server',",
      "  versioning: { kind: 'uri', prefix: 'api', version: '1' },",
      "  route: { resource: 'auctions', segments: [pathParameter('auctionId')] },",
      "});",
    ].join("\n"),
    "apps/web/src/app/api/v1/auctions/[auctionId]/route.ts": "export const GET = () => new Response('no');\n",
  });

  assert.deepEqual(findings.map((finding) => finding.rule), ["next-public-route-handler"]);
});

test("테스트·fixture·문서·생성 OpenAPI의 경로 예시는 검사 대상이 아니다", () => {
  const findings = inspect({
    "apps/server/src/example.test.ts": "const path = '/api/v1/test';\n",
    "apps/web/src/fixtures/example.ts": "const path = '/api/v1/fixture';\n",
    "docs/api.md": "`/api/v1/docs`\n",
    "apps/server/openapi/openapi.json": "{\"paths\":{\"/api/v1/generated\":{}}}\n",
  });

  assert.deepEqual(findings, []);
});
