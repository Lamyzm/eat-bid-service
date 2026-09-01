/** @module 책임: Git pre-push의 필수 gate와 main 전용 AI advisory 실행 순서를 소유한다. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCodexAdvisory } from "./codex-advisory.mjs";
import {
  readRepositoryLocalGitVariables,
  removeRepositoryLocalGitVariables,
  withoutRepositoryLocalGitVariables,
} from "./git-local-environment.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function pushesMain(stdin) {
  return stdin
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => line.trim().split(/\s+/)[2] === "refs/heads/main");
}

function runPnpm(script, environment) {
  const result = spawnSync("pnpm", [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  return result.status ?? 1;
}

/** 필수 gate와 advisory gate의 실패 정책을 분리해 pre-push 순서를 결정한다. */
export async function runPrePush({
  stdin,
  env,
  childEnvironment = withoutRepositoryLocalGitVariables(
    env,
    readRepositoryLocalGitVariables(repositoryRoot),
  ),
  runRequired = runPnpm,
  runAdvisory = async (baseRef, environment) =>
    runCodexAdvisory({
      repoRoot: repositoryRoot,
      baseRef,
      environment,
    }),
  warn = console.warn,
}) {
  if ((await runRequired("test", childEnvironment)) !== 0) return 1;

  const main = pushesMain(stdin);
  if (main && (await runRequired("architecture:check", childEnvironment)) !== 0) return 1;
  if (!main && env.EATBID_AI_REVIEW !== "1") return 0;

  const baseRef = main ? "origin/main" : env.EATBID_REVIEW_BASE || "origin/main";
  const outcome = await runAdvisory(baseRef, childEnvironment);
  if (outcome.category !== "success")
    warn("AI 리뷰는 사용할 수 없었지만 필수 gate가 아니므로 push를 계속합니다.");
  return 0;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const localGitVariables = readRepositoryLocalGitVariables(repositoryRoot);
  const childEnvironment = withoutRepositoryLocalGitVariables(process.env, localGitVariables);
  removeRepositoryLocalGitVariables(process.env, localGitVariables);
  process.exitCode = await runPrePush({
    stdin: Buffer.concat(chunks).toString("utf8"),
    env: childEnvironment,
    childEnvironment,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
