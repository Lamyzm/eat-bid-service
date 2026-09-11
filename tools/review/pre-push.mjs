/** @module 책임: Git pre-push에서 branch↔claim 검사와 main 직접 push 거절, 선택적 AI advisory의 실행 순서를 소유한다. */
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
 * pre-push는 판정자가 아니라 안내다. 병합 판정은 pull request의 CI 하나가 하고(ADR 0050 결정 2·3), 여기서는
 * 로컬에서만 알 수 있는 것 하나(branch↔claim)와 서버가 어차피 거절할 main 직접 push를 먼저 막는다.
 *
 * 예전에는 여기서 `test`·`architecture:check`·`build`를 돌렸다. CI가 같은 것을 다시 돌리고 있었으므로 값을
 * 두 번 냈고, 그러면서 dataplane 검사와 browser 스위트가 빠진 더 좁은 범위로 "통과"라고 말해 2026-09-11에
 * 초록인 채 빨간 커밋이 main에 들어갔다. 게이트를 넓히는 대신 판정자를 하나로 줄인다.
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

  // 서버가 main 직접 push를 거절한다. 여기서 먼저 말해 주는 이유는 거절 메시지가 `pnpm workflow:pr`을
  // 가리켜야 다음에 무엇을 할지 알기 때문이다.
  if (pushesMain(stdin)) {
    warn(
      "main은 서버가 보호합니다(ADR 0050). 직접 push하지 말고 `pnpm workflow:pr`로 pull request를 여십시오.",
    );
    return 1;
  }
  if (env.EATBID_AI_REVIEW !== "1") return 0;

  const baseRef = env.EATBID_REVIEW_BASE || "origin/main";
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
