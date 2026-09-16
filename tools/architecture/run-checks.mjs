/** @module 책임: architecture gate의 검사 목록·변경 범위에 따른 선택·병렬 실행·종합 판정을 한 Node 프로세스에서 소유한다. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  CHANGED_BASE_ENV,
  CHANGED_PATHS_ENV,
  listChangedPaths,
  resolveChangedBase,
} from "../git/changed-paths.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const TYPESCRIPT_SOURCE = /\.[cm]?tsx?$/i;

/**
 * 검사 목록이 곧 architecture gate의 정의다. `script`는 같은 프로세스의 worker thread로, `command`는
 * uv·bun처럼 다른 runtime이 필요한 단계라 child process로 실행한다. `scope`는 `--changed`에서 그 검사를
 * 고르는 경로 조건이고, `weight`는 긴 검사를 먼저 시작해 makespan을 줄이기 위한 상대 비용이다.
 */
export const CHECKS = Object.freeze([
  {
    id: "test-names",
    label: "한국어 테스트 명세",
    script: "tools/quality/check-test-names.mjs",
    weight: 12,
    scope: [/\.(?:test|spec)\.[cm]?[jt]sx?$/i, /(?:^|\/)tests?\/.*\.py$/i, /(?:^|\/)test_[^/]*\.py$/i],
  },
  {
    id: "semantic-values",
    label: "TypeScript 의미 값",
    script: "tools/architecture/check-semantic-values.mjs",
    weight: 9,
    scope: [/^apps\/(?:server|web)\/src\/.*\.[cm]?tsx?$/i, /^packages\/[^/]+\/src\/.*\.[cm]?tsx?$/i],
  },
  {
    id: "python-semantic-values",
    label: "Python 의미 값",
    command: "uv run --project apps/dataplane python tools/quality/check-python-semantic-values.py",
    weight: 8,
    scope: [/^apps\/dataplane\/(?:src|scripts)\/.*\.py$/i],
  },
  {
    id: "web-boundaries",
    label: "Web module 경계",
    script: "tools/architecture/check-web-boundaries.mjs",
    weight: 6,
    scope: [/^apps\/web\/src\//],
  },
  {
    id: "server-boundaries",
    label: "Server module 경계",
    script: "tools/architecture/check-server-boundaries.mjs",
    weight: 1,
    scope: [/^apps\/server\/src\/modules\//],
  },
  {
    id: "contracts-python-models",
    label: "Python 생성 모델 drift",
    command: "pnpm contracts:python:check",
    weight: 4,
    scope: [/^packages\/contracts\//, /^apps\/dataplane\//],
  },
  {
    id: "korean-comments",
    label: "한국어 module 책임",
    script: "tools/quality/check-korean-comments.mjs",
    weight: 2,
    scope: [/\.(?:[cm]?[jt]sx?|py)$/i],
  },
  {
    id: "import-depth",
    label: "상대 경로 import 깊이",
    script: "tools/architecture/check-import-depth.mjs",
    weight: 2,
    // 별칭 해석기가 있는 경로만 고른다. `apps/server`·`packages/contracts`를 왜 뺐는지는
    // check-import-depth.mjs의 EXCLUDED_SCOPES와 ADR 0047이 소유한다.
    scope: [/^apps\/web\/src\/.*\.[cm]?[jt]sx?$/i, /^packages\/(?:db|domain)\/src\/.*\.[cm]?tsx?$/i, /^tools\/.*\.[cm]?jsx?$/i],
  },
  {
    id: "docs",
    label: "문서 위계",
    script: "tools/quality/check-docs.mjs",
    weight: 2,
    scope: [/^docs\/.*\.md$/i, /^(?:AGENTS|ARCHITECTURE)\.md$/],
  },
  {
    id: "contracts-json-schema",
    label: "계약 JSON Schema drift",
    command: "pnpm contracts:check",
    weight: 1,
    scope: [/^packages\/contracts\//],
  },
  {
    id: "region-vocabulary",
    label: "지역 어휘 재선언",
    script: "tools/architecture/check-region-vocabulary.mjs",
    weight: 1,
    scope: [/^(?:apps\/(?:web|server)|packages\/(?:contracts|db))\/src\/.*\.[cm]?tsx?$/i],
  },
  {
    id: "decision-vocabulary",
    label: "결정 어휘 금지",
    script: "tools/architecture/check-decision-vocabulary.mjs",
    weight: 1,
    scope: [/^apps\/web\/src\/.*\.[cm]?tsx?$/i],
  },
  {
    id: "http-operations",
    label: "HTTP operation 경계",
    script: "tools/architecture/check-http-operations.mjs",
    weight: 1,
    scope: [/^(?:apps\/(?:server|web)|packages\/contracts)\/src\//],
  },
  {
    id: "contract-client-exports",
    label: "계약 client export",
    script: "tools/architecture/check-contract-client-exports.mjs",
    weight: 1,
    scope: [/^packages\/contracts\//, /^apps\/web\/(?:src\/|next\.config\.ts$)/],
  },
  {
    id: "agent-skills",
    label: "Agent Skill projection",
    script: "tools/agent-config/sync-skills.mjs",
    args: ["--check"],
    weight: 1,
    scope: [/^\.(?:agents|claude)\/skills\//],
  },
  {
    id: "web-runtime",
    label: "Web runtime 정책",
    script: "tools/architecture/check-web-runtime.mjs",
    weight: 1,
    scope: [/^apps\/web\/(?:package\.json|next\.config\.ts)$/, /^apps\/web\/scripts\/cleanup-templates\//, /^pnpm-workspace\.yaml$/],
  },
  {
    id: "stack-docs",
    label: "stack 문서 drift",
    script: "tools/architecture/check-stack-docs.mjs",
    weight: 1,
    scope: [/^docs\/architecture\/stack\//],
  },
  {
    id: "write-map",
    label: "수집 쓰기 지도 drift",
    script: "tools/architecture/check-write-map.mjs",
    weight: 1,
    scope: [/^apps\/dataplane\/src\//, /^docs\/architecture\/ingestion-write-map\.md$/],
  },
  {
    id: "db-erd",
    label: "DB ERD 생성물 drift",
    script: "tools/architecture/generate-db-erd.mjs",
    args: ["--check"],
    weight: 1,
    scope: [/^packages\/db\/drizzle\//, /^docs\/architecture\/generated\//],
  },
]);

// 검사기 자신·루트 manifest·lockfile이 바뀌면 어떤 검사가 영향을 받는지 경로만으로 말할 수 없다. 전부 실행한다.
const TOOLING_PATH = /^(?:package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|tools\/(?:architecture|quality|agent-config|git)\/)/;

export function parseArguments(argv) {
  const args = argv.filter((item) => item !== "--");
  const options = { changed: false, list: false, base: undefined, only: undefined, jobs: undefined };
  // 값이 빠진 옵션을 조용히 무시하면 `--base` 오타가 자동 기준 탐색으로 강등돼 ADR 0042의 명시 base 실패 성질을 잃는다.
  const valueOf = (index) => {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${args[index]} 옵션에는 값이 필요합니다.`);
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--changed") options.changed = true;
    else if (item === "--list") options.list = true;
    else if (item === "--base") options.base = valueOf(index++);
    else if (item === "--only") options.only = new Set(valueOf(index++).split(",").filter(Boolean));
    else if (item === "--jobs") options.jobs = Number.parseInt(valueOf(index++), 10);
    else throw new Error(`알 수 없는 옵션입니다: ${item}`);
  }
  if (options.only?.size === 0) throw new Error("--only에는 검사 id를 쉼표로 이어 적습니다.");
  if (options.jobs !== undefined && !(options.jobs >= 1)) throw new Error("--jobs는 1 이상의 정수여야 합니다.");
  return options;
}

/** 변경 경로가 어떤 검사의 scope에도 닿지 않으면 그 검사는 건너뛴다. 검사 도구 자체가 바뀌면 전부 고른다. */
export function selectChecks({ checks = CHECKS, changedPaths }) {
  const paths = [...changedPaths];
  if (paths.some((item) => TOOLING_PATH.test(item))) return { selected: [...checks], reason: "tooling" };
  const selected = checks.filter((check) => check.scope.some((pattern) => paths.some((item) => pattern.test(item))));
  return { selected, reason: "scope" };
}

function runScript(check, env) {
  return new Promise((resolve) => {
    const started = performance.now();
    let output = "";
    const worker = new Worker(path.join(repoRoot, check.script), {
      argv: check.args ?? [],
      env,
      stdout: true,
      stderr: true,
    });
    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      output += chunk;
    });
    worker.stderr.on("data", (chunk) => {
      output += chunk;
    });
    worker.on("error", (error) => {
      output += `${error?.stack ?? error}\n`;
    });
    worker.on("exit", (code) => resolve({ check, status: code, output, ms: performance.now() - started }));
  });
}

function runCommand(check, env) {
  return new Promise((resolve) => {
    const started = performance.now();
    let output = "";
    // pnpm·uv는 Windows에서 shell shim으로만 해석되므로 명령 문자열 하나를 shell에 넘긴다.
    const child = spawn(check.command, {
      cwd: repoRoot,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      output += `${error?.stack ?? error}\n`;
    });
    child.on("close", (code) => resolve({ check, status: code ?? 1, output, ms: performance.now() - started }));
  });
}

/** 무거운 검사부터 `jobs`개까지 동시에 시작하고, 끝나는 순서대로 `onResult`에 넘긴다. */
export async function runChecks({ checks, env, jobs, onResult }) {
  const queue = [...checks].sort((left, right) => right.weight - left.weight);
  const results = [];
  let active = 0;
  await new Promise((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) {
        resolve();
        return;
      }
      while (active < jobs && queue.length) {
        const check = queue.shift();
        active += 1;
        (check.command ? runCommand(check, env) : runScript(check, env)).then((result) => {
          active -= 1;
          results.push(result);
          onResult?.(result);
          next();
        });
      }
    };
    next();
  });
  return results;
}

function printResult(result) {
  const seconds = (result.ms / 1000).toFixed(1);
  const lines = result.output.trimEnd().split(/\r?\n/u).filter((line) => line.trim());
  if (result.status === 0) {
    console.log(`통과 ${result.check.id} (${seconds}s) ${lines.at(-1) ?? ""}`);
    for (const line of lines.filter((line) => line.startsWith("경고"))) console.log(`  ${line}`);
    return;
  }
  console.error(`실패 ${result.check.id} · ${result.check.label} (${seconds}s, exit ${result.status})`);
  for (const line of lines) console.error(`  ${line}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.list) {
    for (const check of CHECKS) console.log(`${check.id.padEnd(24)} ${check.label}`);
    return;
  }
  if (!existsSync(path.join(repoRoot, "node_modules", "typescript"))) {
    throw new Error("node_modules가 없습니다. `pnpm install --frozen-lockfile`을 먼저 실행하십시오.");
  }
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
  if (options.base !== undefined) env[CHANGED_BASE_ENV] = options.base;
  let checks = [...CHECKS];
  let heading = "architecture gate 전체";
  if (options.changed) {
    const base = resolveChangedBase({ repoRoot, base: options.base });
    if (base.kind === "unresolved") {
      console.warn(`경고: ${base.reason} 변경 범위를 정할 수 없어 전체 검사를 실행합니다.`);
    } else {
      const changedPaths = listChangedPaths({ repoRoot, baseCommit: base.commit });
      if (changedPaths.length === 0) {
        console.log(`변경 경로가 없어 architecture gate를 건너뜁니다(기준 ${base.ref}@${base.commit.slice(0, 7)}).`);
        return;
      }
      const selection = selectChecks({ checks, changedPaths });
      checks = selection.selected;
      env[CHANGED_PATHS_ENV] = changedPaths.join("\n");
      env[CHANGED_BASE_ENV] = `${base.ref}@${base.commit.slice(0, 7)}`;
      heading = `변경 범위(${base.ref}@${base.commit.slice(0, 7)} 이후 ${changedPaths.length}개 경로${selection.reason === "tooling" ? ", 검사 도구 변경" : ""})`;
      if (checks.length === 0) {
        console.log(`변경 경로 ${changedPaths.length}개가 어떤 architecture 검사에도 해당하지 않아 건너뜁니다.`);
        return;
      }
    }
  }
  if (options.only) {
    const unknown = [...options.only].filter((id) => !CHECKS.some((check) => check.id === id));
    if (unknown.length) throw new Error(`알 수 없는 검사 id입니다: ${unknown.join(", ")} (--list로 확인)`);
    checks = checks.filter((check) => options.only.has(check.id));
    if (checks.length === 0) {
      console.log("--only로 고른 검사가 변경 범위에 해당하지 않아 건너뜁니다.");
      return;
    }
  }
  const jobs = options.jobs ?? Math.max(1, Math.min(checks.length, availableParallelism()));
  console.log(`${heading}: 검사 ${checks.length}개를 동시 ${jobs}개로 실행합니다.`);
  const started = performance.now();
  const results = await runChecks({ checks, env, jobs, onResult: printResult });
  const failed = results.filter((result) => result.status !== 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `architecture gate ${failed.length ? "실패" : "통과"}: 통과 ${results.length - failed.length}개, 실패 ${failed.length}개, ${seconds}s`,
  );
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`architecture gate를 실행하지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  });
}
