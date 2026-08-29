import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const releaseLaneVersion = "1.0.0-rc.4";
const directDependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const directDependencyMinimums = {
  "drizzle-orm": 3,
  "drizzle-kit": 2,
} as const;

type DependencySection = (typeof directDependencySections)[number];
type DrizzleDependency = keyof typeof directDependencyMinimums;
type PackageManifest = Partial<Record<DependencySection, Record<string, string>>>;

type WorkspaceManifest = {
  relativePath: string;
  manifest: PackageManifest;
};

type DrizzleDeclaration = {
  relativePath: string;
  section: DependencySection;
  dependency: DrizzleDependency;
  specifier: string;
};

async function readPackageManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function topLevelSection(source: string, name: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${name}:`);

  if (start === -1) {
    return "";
  }

  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !/^\s/.test(line)) {
      break;
    }

    section.push(line);
  }

  return section.join("\n");
}

function workspacePackageGlobs(workspace: string): string[] {
  return [...topLevelSection(workspace, "packages").matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)]
    .map((match) => match[1]);
}

async function workspaceManifests(workspace: string): Promise<WorkspaceManifest[]> {
  const manifestPaths = await Promise.all(
    workspacePackageGlobs(workspace).map(async (glob) => {
      const match = glob.match(/^([^*/]+)\/\*$/);

      if (!match) {
        throw new Error(`Unsupported workspace package glob: ${glob}`);
      }

      const parent = match[1];
      const entries = await readdir(path.join(root, parent), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !["node_modules", "dist"].includes(entry.name))
        .map((entry) => path.posix.join(parent, entry.name, "package.json"));
    }),
  );

  const candidates = manifestPaths.flat().sort();
  const manifests = await Promise.all(
    candidates.map(async (relativePath) => {
      try {
        return { relativePath, manifest: await readPackageManifest(relativePath) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }

        throw error;
      }
    }),
  );

  return manifests.filter((manifest): manifest is WorkspaceManifest => manifest !== undefined);
}

function drizzleDeclarations(manifests: WorkspaceManifest[]): DrizzleDeclaration[] {
  const declarations: DrizzleDeclaration[] = [];

  for (const { relativePath, manifest } of manifests) {
    for (const section of directDependencySections) {
      for (const dependency of Object.keys(directDependencyMinimums) as DrizzleDependency[]) {
        const specifier = manifest[section]?.[dependency];
        if (specifier !== undefined) {
          declarations.push({ relativePath, section, dependency, specifier });
        }
      }
    }
  }

  return declarations;
}

function resolvedDrizzlePackages(lockfile: string): Array<{ dependency: DrizzleDependency; version: string }> {
  return [...topLevelSection(lockfile, "packages").matchAll(/^ {2}(?:'([^']+)'|([^:\s]+)):\s*$/gm)]
    .map((match) => match[1] ?? match[2])
    .map((key) => key.match(/^(drizzle-(?:orm|kit))@(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ dependency: match[1] as DrizzleDependency, version: match[2] }));
}

function indentedBlock(source: string, indent: number, key: string): string {
  const lines = source.split(/\r?\n/);
  const header = `${" ".repeat(indent)}${key}:`;
  const start = lines.findIndex((line) => line === header);

  if (start === -1) {
    return "";
  }

  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && line.match(/^\s*/)?.[0].length <= indent) {
      break;
    }

    block.push(line);
  }

  return block.join("\n");
}

function scalarInBlock(block: string, indent: number, key: string): string | undefined {
  const match = block.match(new RegExp(`^ {${indent}}${key}: (.+)$`, "m"));
  return match?.[1].replace(/^'(.*)'$/, "$1");
}

function catalogEntry(lockfile: string, dependency: DrizzleDependency) {
  const defaultCatalog = indentedBlock(topLevelSection(lockfile, "catalogs"), 2, "default");
  const dependencyBlock = indentedBlock(defaultCatalog, 4, dependency);

  return {
    specifier: scalarInBlock(dependencyBlock, 6, "specifier"),
    version: scalarInBlock(dependencyBlock, 6, "version"),
  };
}

function importerDrizzleSpecifiers(lockfile: string): Array<{ dependency: DrizzleDependency; specifier?: string }> {
  const lines = topLevelSection(lockfile, "importers").split(/\r?\n/);
  const specifiers: Array<{ dependency: DrizzleDependency; specifier?: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {6}(drizzle-(?:orm|kit)):\s*$/);
    if (!match) {
      continue;
    }

    const block: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (line !== "" && line.match(/^\s*/)?.[0].length <= 6) {
        break;
      }

      block.push(line);
    }

    specifiers.push({
      dependency: match[1] as DrizzleDependency,
      specifier: scalarInBlock(block.join("\n"), 8, "specifier"),
    });
  }

  return specifiers;
}

function isReleaseLaneVersion(version: string): boolean {
  return new RegExp(`^${releaseLaneVersion.replaceAll(".", "\\.")}(?:\\(.+\\))?$`).test(version);
}

function validateDirectDrizzleDeclarations(manifests: WorkspaceManifest[]): string[] {
  const declarations = drizzleDeclarations(manifests);
  const errors = declarations
    .filter(({ specifier }) => specifier !== "catalog:")
    .map(
      ({ relativePath, section, dependency, specifier }) =>
        `${relativePath} ${section}.${dependency} must use catalog: (received ${specifier})`,
    );

  for (const [dependency, minimum] of Object.entries(directDependencyMinimums) as Array<
    [DrizzleDependency, number]
  >) {
    const count = declarations.filter((declaration) => declaration.dependency === dependency).length;
    if (count < minimum) {
      errors.push(`expected at least ${minimum} direct ${dependency} declarations (received ${count})`);
    }
  }

  return errors;
}

function validateLockfileReleaseLane(lockfile: string): string[] {
  const errors: string[] = [];
  const resolved = resolvedDrizzlePackages(lockfile);
  const importers = importerDrizzleSpecifiers(lockfile);

  for (const [dependency, minimum] of Object.entries(directDependencyMinimums) as Array<
    [DrizzleDependency, number]
  >) {
    const catalog = catalogEntry(lockfile, dependency);
    if (catalog.specifier !== releaseLaneVersion || catalog.version !== releaseLaneVersion) {
      errors.push(`${dependency} catalog entry must pin ${releaseLaneVersion}`);
    }

    const importerEntries = importers.filter((entry) => entry.dependency === dependency);
    if (importerEntries.length < minimum) {
      errors.push(`expected at least ${minimum} ${dependency} lockfile importer declarations`);
    }
    for (const { specifier } of importerEntries) {
      if (specifier !== "catalog:") {
        errors.push(`${dependency} lockfile importer must use catalog: (received ${specifier ?? "missing"})`);
      }
    }

    const resolvedEntries = resolved.filter((entry) => entry.dependency === dependency);
    if (resolvedEntries.length === 0) {
      errors.push(`expected a resolved ${dependency} package entry`);
    }
    for (const { version } of resolvedEntries) {
      if (!isReleaseLaneVersion(version)) {
        errors.push(`resolved ${dependency} version must be ${releaseLaneVersion} (received ${version})`);
      }
    }
  }

  return errors;
}

describe("Drizzle toolchain authority", () => {
  test("discovers every first-level workspace package manifest", async () => {
    const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    const manifests = await workspaceManifests(workspace);

    expect(workspacePackageGlobs(workspace)).toEqual(["apps/*", "packages/*"]);
    expect(manifests.map(({ relativePath }) => relativePath)).toContain("apps/server/package.json");
    expect(manifests.map(({ relativePath }) => relativePath)).toContain("packages/db/package.json");
  });

  test("keeps every discovered direct Drizzle declaration on the catalog release lane", async () => {
    const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    const declarations = drizzleDeclarations(await workspaceManifests(workspace));

    expect(declarations.filter(({ dependency }) => dependency === "drizzle-orm").length).toBeGreaterThanOrEqual(
      directDependencyMinimums["drizzle-orm"],
    );
    expect(declarations.filter(({ dependency }) => dependency === "drizzle-kit").length).toBeGreaterThanOrEqual(
      directDependencyMinimums["drizzle-kit"],
    );
    expect(validateDirectDrizzleDeclarations(await workspaceManifests(workspace))).toEqual([]);
  });

  test("rejects a newly discovered direct declaration that bypasses the catalog", () => {
    const errors = validateDirectDrizzleDeclarations([
      {
        relativePath: "apps/future/package.json",
        manifest: { dependencies: { "drizzle-orm": "1.0.0-beta.22" } },
      },
    ]);

    expect(errors).toContain(
      "apps/future/package.json dependencies.drizzle-orm must use catalog: (received 1.0.0-beta.22)",
    );
  });

  test("keeps catalog, importers, and resolved Drizzle packages on one exact lockfile lane", async () => {
    const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
    const resolved = resolvedDrizzlePackages(lockfile);

    expect(resolved).toEqual(
      expect.arrayContaining([
        { dependency: "drizzle-kit", version: releaseLaneVersion },
        { dependency: "drizzle-orm", version: releaseLaneVersion },
      ]),
    );
    expect(validateLockfileReleaseLane(lockfile)).toEqual([]);
  });

  test("rejects a synthetic second resolved Drizzle lane", () => {
    const errors = validateLockfileReleaseLane(`packages:
  drizzle-orm@${releaseLaneVersion}:
    resolution: {}
  drizzle-orm@1.0.0-beta.22:
    resolution: {}
`);

    expect(errors).toContain(
      "resolved drizzle-orm version must be 1.0.0-rc.4 (received 1.0.0-beta.22)",
    );
  });
});
