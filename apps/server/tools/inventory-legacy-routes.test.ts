import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateLegacyRouteInventory,
  serializeLegacyRouteInventory,
  writeLegacyRouteInventory,
} from "./inventory-legacy-routes";

const legacyCommit = "08405942e64fc22777e64e30f8e3698627a98850";
const repoRoot = resolve(import.meta.dir, "../../..");

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

  // 임시 디렉터리는 이 테스트 안에서 만들고 이 테스트 안에서 지운다. afterEach로 지우면 러너가 이
  // 테스트를 먼저 실패 처리한 뒤 hook을 돌릴 때 아직 실행 중인 본문이 사라진 파일을 읽어 ENOENT로
  // 죽고, 진짜 원인이 "first.json이 없다"로 바뀐다.
  test("두 번째 실행과 commit artifact 모두에 byte-identical하게 재생성한다", () => {
    const root = mkdtempSync(join(tmpdir(), "eatbid-route-inventory-"));
    try {
      const first = join(root, "first.json");
      const second = join(root, "second.json");

      writeLegacyRouteInventory({ repoRoot, commit: legacyCommit, outputPath: first });
      // 첫 산출물을 바로 단언한다. 여기서 걸러야 아래 비교가 ENOENT 대신 "첫 실행이 아무것도 쓰지
      // 못했다"고 말한다.
      expect(existsSync(first)).toBe(true);
      expect(statSync(first).size).toBeGreaterThan(0);

      writeLegacyRouteInventory({ repoRoot, commit: legacyCommit, outputPath: second });

      const firstBytes = readFileSync(first);
      expect(readFileSync(second)).toEqual(firstBytes);
      expect(readFileSync(resolve(repoRoot, "docs/architecture/legacy-server-route-inventory.json"))).toEqual(firstBytes);
      expect(firstBytes.toString("utf8")).toBe(serializeLegacyRouteInventory(
        generateLegacyRouteInventory({ repoRoot, commit: legacyCommit }),
      ));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
