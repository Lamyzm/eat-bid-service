import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function packageJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

describe("Drizzle toolchain authority", () => {
  test("all direct consumers use the one pnpm catalog release lane", async () => {
    const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("drizzle-orm: 1.0.0-rc.4");
    expect(workspace).toContain("drizzle-kit: 1.0.0-rc.4");

    for (const manifest of [
      await packageJson("packages/db/package.json"),
      await packageJson("packages/shared/package.json"),
      await packageJson("apps/server/package.json"),
    ]) {
      expect(manifest.dependencies?.["drizzle-orm"] ?? manifest.devDependencies?.["drizzle-orm"])
        .toBe("catalog:");
    }

    for (const manifest of [
      await packageJson("packages/db/package.json"),
      await packageJson("packages/shared/package.json"),
    ]) {
      expect(manifest.devDependencies?.["drizzle-kit"]).toBe("catalog:");
    }
  });
});
