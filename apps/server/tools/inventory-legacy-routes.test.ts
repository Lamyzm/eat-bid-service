import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateLegacyRouteInventory,
  serializeLegacyRouteInventory,
  writeLegacyRouteInventory,
} from "./inventory-legacy-routes";

const legacyCommit = "08405942e64fc22777e64e30f8e3698627a98850";
const repoRoot = resolve(import.meta.dir, "../../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("legacy route 목록 계약", () => {
  test("@All을 포함한 고정 controller·route surface를 정적으로 산출한다", () => {
    const inventory = generateLegacyRouteInventory({ repoRoot, commit: legacyCommit });

    expect(inventory.sourceCommit).toBe(legacyCommit);
    expect(inventory.globalPrefix).toBe("api");
    expect(inventory.controllers).toHaveLength(13);
    expect(inventory.routes).toHaveLength(34);
    expect(inventory.routes).toContainEqual(expect.objectContaining({
      controller: "AuthController",
      handler: "handle",
      httpMethod: "ALL",
      fullPath: "/api/auth/*path",
      authClassification: "provider-transport",
    }));
    expect(inventory.routes).toContainEqual(expect.objectContaining({
      controller: "MeController",
      handler: "putBiz",
      httpMethod: "PUT",
      fullPath: "/api/me/biz",
      authClassification: "session-checked-in-handler",
    }));
    for (const source of Object.values(inventory.sources)) {
      expect(source.blobHash).toMatch(/^[0-9a-f]{40}$/);
      expect(source.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const route of inventory.routes) expect(route.sourceLine).toBeGreaterThan(0);
  });

  test("두 번째 실행과 commit artifact 모두에 byte-identical하게 재생성한다", () => {
    const root = mkdtempSync(join(tmpdir(), "eatbid-route-inventory-"));
    tempRoots.push(root);
    const first = join(root, "first.json");
    const second = join(root, "second.json");

    writeLegacyRouteInventory({ repoRoot, commit: legacyCommit, outputPath: first });
    writeLegacyRouteInventory({ repoRoot, commit: legacyCommit, outputPath: second });

    const firstBytes = readFileSync(first);
    expect(readFileSync(second)).toEqual(firstBytes);
    expect(readFileSync(resolve(repoRoot, "docs/architecture/legacy-server-route-inventory.json"))).toEqual(firstBytes);
    expect(firstBytes.toString("utf8")).toBe(serializeLegacyRouteInventory(
      generateLegacyRouteInventory({ repoRoot, commit: legacyCommit }),
    ));
  });
});
