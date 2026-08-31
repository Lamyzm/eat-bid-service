import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectContractClientExports } from "./check-contract-client-exports.mjs";

function inspect(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-contract-client-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
    return inspectContractClientExports({ repoRoot: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const packageJson = JSON.stringify({
  exports: {
    "./api/v1/auctions": {
      types: "./src/api/v1/auctions/index.ts",
      import: "./src/api/v1/auctions/index.ts",
      default: "./src/api/v1/auctions/index.ts",
    },
  },
});

test("browser-safe 공고 subpath는 source ESM graph만 공개한다", () => {
  const findings = inspect({
    "packages/contracts/package.json": packageJson,
    "packages/contracts/src/api/v1/auctions/index.ts": "export { schema } from './schema';\n",
    "packages/contracts/src/api/v1/auctions/schema.ts": "import { z } from 'zod'; export const schema = z.string();\n",
    "apps/web/next.config.ts": "export default { transpilePackages: ['@eatbid/contracts'] };\n",
    "apps/web/src/page.ts": "import { schema } from '@eatbid/contracts/api/v1/auctions'; void schema;\n",
  });

  assert.deepEqual(findings, []);
});

test("client subpath의 dist·domain·ingestion·server-only 전이 의존을 거부한다", () => {
  const findings = inspect({
    "packages/contracts/package.json": JSON.stringify({
      exports: {
        "./api/v1/auctions": {
          types: "./dist/api/v1/auctions/index.d.ts",
          import: "./dist/api/v1/auctions/index.js",
          default: "./dist/api/v1/auctions/index.js",
        },
      },
    }),
    "packages/contracts/src/api/v1/auctions/index.ts": [
      "import '@eatbid/domain';",
      "export * from '../../../../ingestion/v1/normalized-auction';",
      "import 'server-only';",
    ].join("\n"),
    "packages/contracts/src/ingestion/v1/normalized-auction.ts": "export const value = 1;\n",
    "apps/web/next.config.ts": "export default { transpilePackages: [] };\n",
  });

  assert.deepEqual(new Set(findings.map((finding) => finding.rule)), new Set([
    "client-export-dist-target",
    "client-export-forbidden-import",
    "contracts-transpile-missing",
  ]));
});

test("Web source의 contracts package root import를 거부한다", () => {
  const findings = inspect({
    "packages/contracts/package.json": packageJson,
    "packages/contracts/src/api/v1/auctions/index.ts": "export const operation = {};\n",
    "apps/web/next.config.ts": "export default { transpilePackages: ['@eatbid/contracts'] };\n",
    "apps/web/src/page.ts": "import { auctionV1Operations } from '@eatbid/contracts'; void auctionV1Operations;\n",
  });

  assert.ok(findings.some((finding) => finding.rule === "web-contract-root-import"));
});
