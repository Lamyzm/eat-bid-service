import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type PackageManifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function json(relativePath: string): PackageManifest {
  return JSON.parse(readFileSync(join(repositoryRoot, relativePath), "utf8"));
}

function text(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function workspaceManifests(): Array<{ relativePath: string; manifest: PackageManifest }> {
  const workspace = text("pnpm-workspace.yaml");
  const packageSection = workspace.match(/^packages:\s*\n((?:\s+-\s+.+\n?)+)/m)?.[1] ?? "";
  const globs = [...packageSection.matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map(
    (match) => match[1],
  );

  if (globs.length === 0) {
    throw new Error("pnpm workspace has no package globs");
  }

  return globs.flatMap((glob) => {
    const match = /^([^*/]+)\/\*$/.exec(glob);
    if (!match) {
      throw new Error(`Unsupported workspace package glob: ${glob}`);
    }

    const parent = match[1];
    return readdirSync(join(repositoryRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !["node_modules", "dist"].includes(entry.name))
      .flatMap((entry) => {
        const relativePath = `${parent}/${entry.name}/package.json`;
        try {
          return [{ relativePath, manifest: json(relativePath) }];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
          }
          throw error;
        }
      });
  });
}

function sourceFiles(relativeDirectory: string): string[] {
  return readdirSync(join(repositoryRoot, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(relativePath);
      return entry.isFile() && relativePath.endsWith(".ts") && !relativePath.endsWith(".test.ts")
        ? [relativePath]
        : [];
    });
}

describe("검증 범위를 정의한다 — DDL package authority", () => {
  test("routing 결과를 검증한다 — routes root migration commands and tests through packages/db", () => {
    const root = json("package.json");

    expect(root.scripts?.["db:generate"]).toBe("pnpm --filter @eatbid/db db:generate");
    expect(root.scripts?.["db:migrate"]).toBe("pnpm --filter @eatbid/db db:migrate");
    expect(root.scripts?.["db:push"]).toBeUndefined();
    expect(root.scripts?.test).toContain("packages/db/src");
  });

  test("보존 조건을 검증한다 — keeps Drizzle authoring tools out of shared", () => {
    const shared = json("packages/shared/package.json");

    expect(shared.scripts?.["db:generate"]).toBeUndefined();
    expect(shared.scripts?.["db:push"]).toBeUndefined();
    expect(shared.devDependencies?.["drizzle-kit"]).toBeUndefined();
  });

  test("보존 조건을 검증한다 — keeps the exact postgres-js catalog and permits only infrastructure server consumers", () => {
    const workspace = text("pnpm-workspace.yaml");
    const database = json("packages/db/package.json");
    const server = json("apps/server/package.json");

    expect(workspace).toContain("postgres: 3.4.9");
    expect(database.dependencies?.postgres).toBe("catalog:");
    expect(server.dependencies?.postgres).toBe("catalog:");
    expect(server.dependencies?.["drizzle-orm"]).toBe("catalog:");
    expect(server.dependencies?.["@eatbid/db"]).toBe("workspace:*");
    expect(server.dependencies?.["drizzle-kit"]).toBeUndefined();

    const databaseImports = sourceFiles("apps/server/src").filter((relativePath) =>
      /from\s+["'](?:@eatbid\/db|drizzle-orm|postgres)(?:\/[^"']*)?["']/.test(text(relativePath)));
    expect(databaseImports.every((relativePath) =>
      relativePath.startsWith("apps/server/src/platform/database/")
      || /^apps\/server\/src\/modules\/[^/]+\/infrastructure\/drizzle\//.test(relativePath)))
      .toBe(true);
  });

  test("탐지 결과를 검증한다 — discovers every workspace manifest and keeps direct Drizzle DDL in packages/db", () => {
    const workspace = workspaceManifests();
    const manifests = [{ relativePath: "package.json", manifest: json("package.json") }, ...workspace];
    const directCommandOwners = new Set<string>();
    const drizzleKitDependencyOwners = new Set<string>();
    const pushOwners = new Set<string>();

    for (const { relativePath, manifest } of manifests) {
      for (const [scriptName, script] of Object.entries(manifest.scripts ?? {})) {
        if (/drizzle-kit\s+(generate|check|migrate)\b/.test(script)) {
          directCommandOwners.add(relativePath);
        }
        if (scriptName === "db:push" || /drizzle-kit\s+push\b|\bdb:push\b/.test(script)) {
          pushOwners.add(relativePath);
        }
      }
      for (const section of dependencySections) {
        if (manifest[section]?.["drizzle-kit"] !== undefined) {
          drizzleKitDependencyOwners.add(relativePath);
        }
      }
    }

    expect(workspace.length).toBeGreaterThan(0);
    expect(workspace.map(({ relativePath }) => relativePath)).toContain("packages/db/package.json");
    expect([...directCommandOwners]).toEqual(["packages/db/package.json"]);
    expect([...drizzleKitDependencyOwners]).toEqual(["packages/db/package.json"]);
    expect([...pushOwners]).toEqual([]);
  });
});

describe("검증 범위를 정의한다 — active Kubernetes DDL path", () => {
  test("금지 조건을 검증한다 — does not generate or mount the legacy schema ConfigMap", () => {
    const baseDirectory = join(repositoryRoot, "infra/k8s/base");
    const activeYaml = readdirSync(baseDirectory)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => readFileSync(join(baseDirectory, name), "utf8"))
      .join("\n");

    expect(activeYaml).not.toContain("db-schema");
    expect(activeYaml).not.toContain("schema.sql");
  });

  test("제거 결과를 검증한다 — removes the complete legacy db-migrate Job document", () => {
    const documents = text("infra/k8s/base/app.yaml").split(/^---\s*$/m);
    const legacyJobs = documents.filter(
      (document) => /kind:\s*Job\b/.test(document) && /name:\s*db-migrate\b/.test(document),
    );

    expect(legacyJobs).toEqual([]);
  });
});

describe("검증 범위를 정의한다 — migration image contract", () => {
  test("빌드 결과를 검증한다 — builds and deploys the frozen database package from the monorepo root", () => {
    const dockerfile = text("packages/db/Dockerfile");

    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm --filter @eatbid/db build");
    expect(dockerfile).toContain("pnpm --filter @eatbid/db deploy --prod");
    expect(dockerfile).toContain("COPY --from=build /runtime");
  });

  test("배포 산출물을 검증한다 — ships the committed migration chain and runs the compiled entrypoint as non-root", () => {
    const dockerfile = text("packages/db/Dockerfile");

    expect(dockerfile).toContain("packages/db/drizzle");
    expect(dockerfile).not.toContain("schema.sql");
    expect(dockerfile).toMatch(/^USER\s+(?!root\b)\S+/m);
    expect(dockerfile).toContain('CMD ["node", "dist/migrate.js"]');
  });
});
