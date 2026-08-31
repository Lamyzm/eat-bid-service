import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(repositoryRoot, "tools", "architecture", "check-web-runtime.mjs");

const productionDependencies = {
  "@eatbid/contracts": "workspace:*",
  "@tanstack/react-form": "1.33.5",
  "@tanstack/react-query": "5.102.8",
  "@tanstack/react-query-devtools": "5.102.8",
  next: "16.3.4",
  react: "19.2.8",
  "react-dom": "19.2.8",
  "server-only": "0.0.1",
  zod: "catalog:",
};

const developmentDependencies = {
  "@happy-dom/global-registrator": "20.12.0",
  "@tailwindcss/postcss": "4.3.3",
  "@testing-library/react": "16.3.3",
  "@testing-library/user-event": "14.6.6",
  "@types/bun": "1.2.22",
  "babel-plugin-react-compiler": "1.0.0",
  "happy-dom": "20.12.0",
  "tailwindcss": "4.3.3",
  "typescript": "5.9.3",
};

const validNextConfig = `
import type { NextConfig } from 'next';

const config: NextConfig = {
  typedRoutes: true,
  reactCompiler: {
    compilationMode: 'annotation'
  }
};

export default config;
`;

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({ mutateWeb, nextConfig = validNextConfig, zodVersion = "4.5.4" } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "eatbid-web-runtime-"));
  const webDirectory = path.join(directory, "apps", "web");
  mkdirSync(webDirectory, { recursive: true });

  const webPackage = {
    name: "@eatbid/web",
    scripts: {
      typecheck: "next typegen && tsc --noEmit",
    },
    dependencies: { ...productionDependencies },
    devDependencies: { ...developmentDependencies },
  };
  mutateWeb?.(webPackage);

  writeJson(path.join(directory, "package.json"), { private: true });
  writeJson(path.join(webDirectory, "package.json"), webPackage);
  writeFileSync(path.join(directory, "pnpm-workspace.yaml"), `packages:\n  - 'apps/*'\n\ncatalog:\n  zod: ${zodVersion}\n`);
  writeFileSync(path.join(webDirectory, "next.config.ts"), nextConfig);
  return directory;
}

function runChecker(directory) {
  const result = spawnSync(process.execPath, [checker], {
    cwd: repositoryRoot,
    env: { ...process.env, WEB_RUNTIME_ROOT: directory },
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function withFixture(options, assertion) {
  const directory = createFixture(options);
  try {
    assertion(runChecker(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("검토된 exact Web 런타임 fixture를 허용한다", () => {
  withFixture({}, ({ status, output }) => {
    assert.equal(status, 0, output);
  });
});

test("기반 의존성의 범위 버전과 잘못된 dependency 위치를 함께 거부한다", () => {
  withFixture({
    mutateWeb(webPackage) {
      webPackage.dependencies.next = "^16.3.4";
      webPackage.dependencies.typescript = webPackage.devDependencies.typescript;
      delete webPackage.devDependencies.typescript;
    },
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /next.*16\.3\.4/);
    assert.match(output, /typescript.*devDependencies/);
  });
});

test("Web Zod가 catalog를 우회하거나 root catalog가 drift하면 거부한다", () => {
  withFixture({
    zodVersion: "^4.5.4",
    mutateWeb(webPackage) {
      webPackage.dependencies.zod = "4.5.4";
    },
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /zod.*catalog:/i);
    assert.match(output, /4\.5\.4/);
  });
});

test("React 19와 호환되지 않는 kbar 선언을 거부한다", () => {
  withFixture({
    mutateWeb(webPackage) {
      webPackage.dependencies.kbar = "0.1.0-beta.48";
    },
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /kbar/);
  });
});

test("결정적인 Next type 생성이 빠진 typecheck를 거부한다", () => {
  withFixture({
    mutateWeb(webPackage) {
      webPackage.scripts.typecheck = "tsc --noEmit";
    },
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /next typegen && tsc --noEmit/);
  });
});

test("typed route와 annotation mode가 없는 Next 설정을 거부한다", () => {
  withFixture({
    nextConfig: `const config = { reactCompiler: true }; export default config;`,
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /typedRoutes/);
    assert.match(output, /compilationMode.*annotation/);
  });
});

test("검토하지 않은 Cache Components와 Rust compiler 활성화를 거부한다", () => {
  withFixture({
    nextConfig: `
const config = {
  typedRoutes: true,
  reactCompiler: { compilationMode: 'annotation' },
  cacheComponents: true,
  experimental: { turbopackRustReactCompiler: true }
};
export default config;
`,
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /cacheComponents/);
    assert.match(output, /turbopackRustReactCompiler/);
  });
});

test("TanStack Form v2와 prerelease 범위를 거부한다", () => {
  withFixture({
    mutateWeb(webPackage) {
      webPackage.dependencies["@tanstack/react-form"] = "2.0.0-alpha.3";
    },
  }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /@tanstack\/react-form.*1\.33\.5/);
  });
});
