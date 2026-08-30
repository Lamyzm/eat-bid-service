import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkArchitecture } from "./check-architecture";

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixture(files: Record<string, string>, paths: Record<string, string[]> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "eatbid-architecture-"));
  fixtureRoots.push(root);
  write(root, "tsconfig.json", JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "commonjs",
      moduleResolution: "node",
      experimentalDecorators: true,
      baseUrl: ".",
      paths,
    },
    include: ["src/**/*.ts"],
  }));
  write(root, "node_modules/@nestjs/common/index.d.ts", [
    "export declare function Module(metadata: unknown): ClassDecorator;",
    "export declare function Controller(path?: string): ClassDecorator;",
  ].join("\n"));
  for (const moduleName of ["drizzle-orm", "postgres", "@eatbid/db", "effect", "zod"]) {
    write(root, `node_modules/${moduleName}/index.d.ts`, "export declare const dependency: unique symbol;\n");
  }
  write(root, "node_modules/effect/Effect.d.ts", [
    "export declare function runPromise<A>(effect: A): Promise<A>;",
    "export declare function runPromiseExit<A>(effect: A): Promise<A>;",
  ].join("\n"));
  write(root, "src/platform/effect/effect.module.ts", "export class EffectModule {}\n");
  write(root, "src/app.module.ts", [
    'import { Module } from "@nestjs/common";',
    'import { EffectModule } from "./platform/effect/effect.module";',
    "@Module({ imports: [EffectModule] })",
    "export class AppModule {}",
  ].join("\n"));
  for (const [path, contents] of Object.entries(files)) write(root, path, contents);
  return join(root, "tsconfig.json");
}

function rules(projectPath: string): string[] {
  return checkArchitecture({ projectPath }).map((violation) => violation.rule);
}

describe("TypeScript-resolved server architecture", () => {
  test("accepts the clean import-only composition fixture", () => {
    expect(checkArchitecture({ projectPath: fixture({}) })).toEqual([]);
  });

  for (const packageName of ["drizzle-orm", "postgres", "@eatbid/db"]) {
    test(`rejects a controller direct import of ${packageName}`, () => {
      const projectPath = fixture({
        "src/modules/orders/presentation/http/orders.controller.ts": `import { dependency } from "${packageName}"; export const leak = dependency;`,
      });
      expect(rules(projectPath)).toContain("controller-database-boundary");
    });
  }

  test("rejects a controller CommonJS require of a database package", () => {
    const projectPath = fixture({
      "src/modules/orders/presentation/http/orders.controller.ts": 'const database = require("@eatbid/db"); export const leak = database;',
    });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  test("rejects a controller literal dynamic import of a database package", () => {
    const projectPath = fixture({
      "src/modules/orders/presentation/http/orders.controller.ts": 'export const leak = () => import("drizzle-orm");',
    });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  for (const expression of ["require(packageName)", "import(packageName)"]) {
    test(`rejects a non-literal module reference through ${expression.split("(")[0]}`, () => {
      const projectPath = fixture({
        "src/modules/orders/application/load.ts": `const packageName = "effect"; export const load = () => ${expression};`,
      });
      expect(rules(projectPath)).toContain("non-literal-module-reference");
    });
  }

  test("rejects a controller database-schema import resolved through a tsconfig alias", () => {
    const projectPath = fixture({
      "src/database/schema.ts": "export const table = 1;",
      "src/modules/orders/presentation/http/orders.controller.ts": 'import { table } from "@schema"; export const leak = table;',
    }, { "@schema": ["src/database/schema.ts"] });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  test("rejects a controller reaching the DB package root through a tsconfig alias", () => {
    const projectPath = fixture({
      "packages/db/src/index.ts": "export const database = 1;",
      "src/modules/orders/presentation/http/orders.controller.ts": 'import { database } from "@database"; export const leak = database;',
    }, { "@database": ["packages/db/src/index.ts"] });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  test("rejects a controller reaching Drizzle through a local re-export", () => {
    const projectPath = fixture({
      "src/modules/orders/infrastructure/db-barrel.ts": 'export { dependency } from "drizzle-orm";',
      "src/modules/orders/presentation/http/orders.controller.ts": 'import { dependency } from "../../infrastructure/db-barrel"; export const leak = dependency;',
    });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  test("reports the actual forbidden edge and controller reachability path", () => {
    const projectPath = fixture({
      "src/modules/orders/infrastructure/db-barrel.ts": '\nexport { dependency } from "drizzle-orm";',
      "src/modules/orders/presentation/http/orders.controller.ts": 'import { dependency } from "../../infrastructure/db-barrel"; export const leak = dependency;',
    });
    const [violation] = checkArchitecture({ projectPath }).filter(
      (item) => item.rule === "controller-database-boundary",
    );
    expect(violation?.file).toBe("src/modules/orders/infrastructure/db-barrel.ts");
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain(
      "src/modules/orders/presentation/http/orders.controller.ts -> src/modules/orders/infrastructure/db-barrel.ts",
    );
  });

  test("discovers a Nest controller decorator imported under an alias", () => {
    const projectPath = fixture({
      "src/modules/orders/presentation/http/orders.endpoint.ts": [
        'import { Controller as HttpController } from "@nestjs/common";',
        'import { dependency } from "drizzle-orm";',
        '@HttpController("orders")',
        "export class OrdersEndpoint { readonly leak = dependency; }",
      ].join("\n"),
    });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  test("discovers a Nest controller decorator through a local re-export", () => {
    const projectPath = fixture({
      "src/platform/http/decorators.ts": 'export { Controller as HttpController } from "@nestjs/common";',
      "src/modules/orders/presentation/http/orders.endpoint.ts": [
        'import { HttpController } from "../../../../platform/http/decorators";',
        'import { dependency } from "postgres";',
        '@HttpController("orders")',
        "export class OrdersEndpoint { readonly leak = dependency; }",
      ].join("\n"),
    });
    expect(rules(projectPath)).toContain("controller-database-boundary");
  });

  for (const packageName of ["@nestjs/common", "effect", "drizzle-orm", "zod", "node:http"]) {
    test(`rejects domain code importing ${packageName}`, () => {
      const projectPath = fixture({
        "src/modules/orders/domain/order.ts": `import * as forbidden from "${packageName}"; export const leak = forbidden;`,
      });
      expect(rules(projectPath)).toContain("domain-framework-free");
    });
  }

  for (const layer of ["presentation", "infrastructure"]) {
    test(`rejects application code importing its ${layer} layer`, () => {
      const projectPath = fixture({
        [`src/modules/orders/${layer}/dependency.ts`]: "export const leak = 1;",
        "src/modules/orders/application/use-case.ts": `import { leak } from "../${layer}/dependency"; export const result = leak;`,
      });
      expect(rules(projectPath)).toContain("application-dependency-direction");
    });
  }

  test("rejects an aliased Effect.runPromise symbol outside EffectRunner", () => {
    const projectPath = fixture({
      "src/modules/orders/application/use-case.ts": 'import { runPromise as execute } from "effect/Effect"; void execute(1);',
    });
    expect(rules(projectPath)).toContain("effect-runner-only");
  });

  test("rejects a namespace Effect.runPromiseExit call outside EffectRunner", () => {
    const projectPath = fixture({
      "src/modules/orders/application/use-case.ts": 'import * as Effect from "effect/Effect"; void Effect.runPromiseExit(1);',
    });
    expect(rules(projectPath)).toContain("effect-runner-only");
  });

  for (const declaration of ["controllers: [FeatureController]", "providers: [FeatureService]"]) {
    test(`rejects root AppModule metadata containing ${declaration.split(":")[0]}`, () => {
      const projectPath = fixture({
        "src/app.module.ts": [
          'import { Module } from "@nestjs/common";',
          "class FeatureController {}",
          "class FeatureService {}",
          `@Module({ imports: [], ${declaration} })`,
          "export class AppModule {}",
        ].join("\n"),
      });
      expect(rules(projectPath)).toContain("root-module-import-only");
    });
  }

  test("rejects root AppModule metadata containing a spread", () => {
    const projectPath = fixture({
      "src/app.module.ts": [
        'import { Module } from "@nestjs/common";',
        "class FeatureService {}",
        "const extra = { providers: [FeatureService] };",
        "@Module({ imports: [], ...extra })",
        "export class AppModule {}",
      ].join("\n"),
    });
    expect(rules(projectPath)).toContain("root-module-import-only");
  });

  for (const key of ["providers", "controllers"]) {
    test(`rejects root AppModule metadata containing computed ${key}`, () => {
      const projectPath = fixture({
        "src/app.module.ts": [
          'import { Module } from "@nestjs/common";',
          `const forbiddenKey = "${key}";`,
          "class FeatureDependency {}",
          "@Module({ imports: [], [forbiddenKey]: [FeatureDependency] })",
          "export class AppModule {}",
        ].join("\n"),
      });
      expect(rules(projectPath)).toContain("root-module-import-only");
    });
  }

  for (const internalLayer of ["presentation", "infrastructure"]) {
    test(`rejects a feature importing another feature's ${internalLayer} internals`, () => {
      const projectPath = fixture({
        [`src/modules/catalog/${internalLayer}/private.ts`]: "export const internal = 1;",
        "src/modules/orders/application/use-case.ts": `import { internal } from "../../catalog/${internalLayer}/private"; export const leak = internal;`,
      });
      expect(rules(projectPath)).toContain("cross-feature-internal-import");
    });
  }

  test("rejects a cycle in the server source dependency graph", () => {
    const projectPath = fixture({
      "src/modules/orders/application/a.ts": 'import { b } from "./b"; export const a = b;',
      "src/modules/orders/application/b.ts": 'import { a } from "./a"; export const b = a;',
    });
    expect(rules(projectPath)).toContain("source-dependency-cycle");
  });

  test("rejects a source dependency cycle formed by literal dynamic imports", () => {
    const projectPath = fixture({
      "src/modules/orders/application/a.ts": 'export const a = () => import("./b");',
      "src/modules/orders/application/b.ts": 'export const b = () => import("./a");',
    });
    expect(rules(projectPath)).toContain("source-dependency-cycle");
  });

  test("rejects a source dependency cycle formed by CommonJS requires", () => {
    const projectPath = fixture({
      "src/modules/orders/application/a.ts": 'export const a = () => require("./b");',
      "src/modules/orders/application/b.ts": 'export const b = () => require("./a");',
    });
    expect(rules(projectPath)).toContain("source-dependency-cycle");
  });
});
