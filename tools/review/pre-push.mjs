/** @module 책임: Git pre-push의 필수 gate와 main 전용 AI advisory 실행 순서를 소유한다. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommitGuard } from "../agent-workflow/commit-guard.mjs";
import { formatAttempts, renderOutcome, runAiAdvisory } from "./ai-advisory.mjs";
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

/**
 * 필수 gate와 advisory gate의 실패 정책을 분리해 pre-push 순서를 결정한다. branch↔claim 검사가 가장
 * 먼저다. 몇 초짜리 로컬 판정이 몇 분짜리 테스트보다 앞에 와야 잘못된 branch의 push가 빨리 끝난다.
 */
export async function runPrePush({
  stdin,
  env,
  childEnvironment = withoutRepositoryLocalGitVariables(
    env,
    readRepositoryLocalGitVariables(repositoryRoot),
  ),
  checkClaims = (pushStdin, environment) =>
    runCommitGuard({ environment, stage: "pre-push", stdin: pushStdin }),
  runRequired = runPnpm,
  runAdvisory = async (baseRef, environment) =>
    runAiAdvisory({
      repoRoot: repositoryRoot,
      baseRef,
      provider: "auto",
      environment,
    }),
  warn = console.warn,
  log = console.log,
}) {
  if ((await checkClaims(stdin, childEnvironment)) !== 0) return 1;
  if ((await runRequired("test", childEnvironment)) !== 0) return 1;

  const main = pushesMain(stdin);
  if (main && (await runRequired("architecture:check", childEnvironment)) !== 0) return 1;
  // build는 main push에만 둔다. CI validate.yml은 셋을 다 돌리는데 이 gate에 build가 없어서, prerender에서만
  // 터지는 결함이 main에 들어가 14시간 red로 남았다(2026-09-10 EAT-143 -> EAT-163). tsc와 bun test는
  // next build의 prerender 경로를 태우지 않으므로 이 자리를 다른 검사로 대신할 수 없다.
  if (main && (await runRequired("build", childEnvironment)) !== 0) return 1;
  if (!main && env.EATBID_AI_REVIEW !== "1") return 0;

  const baseRef = main ? "origin/main" : env.EATBID_REVIEW_BASE || "origin/main";
  const outcome = await runAdvisory(baseRef, childEnvironment);
  if (outcome.category !== "success") {
    const trail = formatAttempts(outcome.attempts);
    warn(
      `AI 리뷰는 사용할 수 없었지만 필수 gate가 아니므로 push를 계속합니다.${trail ? ` (${trail})` : ""}`,
    );
    return 0;
  }
  for (const line of renderOutcome(outcome)) log(line);
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
