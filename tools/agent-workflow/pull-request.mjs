/** @module 책임: issue branch를 원격에 올리고 pull request를 열어 CI 초록에 자동 병합되게 하는 절차를 소유한다. */
import { spawnSync } from "node:child_process";

import { evaluateBranchClaim } from "./commit-guard.mjs";
import { targetRepositoryContext } from "./runtime.mjs";
import { getWorktreeClaim, loadState } from "./state.mjs";

const BASE_BRANCH = "main";

/**
 * 실행 전에 무엇을 할지 먼저 계산한다. push·pull request 생성·자동 병합은 원격에 닿는 행위라,
 * 판정과 실행을 한 덩어리로 두면 어떤 조건에서 무엇이 일어나는지 테스트가 못 본다.
 *
 * `main`을 직접 올리는 경로는 여기에 없다. 병합은 pull request의 CI가 정한다(ADR 0050 결정 1).
 */
export function planPullRequest({ branch, claim, issueUrl, subject }) {
  if (!branch || branch === BASE_BRANCH) {
    return { ok: false, message: `${BASE_BRANCH}에서는 pull request를 열 수 없습니다. issue branch로 옮기세요.` };
  }

  const verdict = evaluateBranchClaim({ branch, claim });
  if (!verdict.ok) return { ok: false, message: verdict.message };
  if (!verdict.issue) {
    return { ok: false, message: `branch ${branch}에 issue 식별자가 없습니다. issue branch에서 실행하세요.` };
  }
  if (!subject) {
    return { ok: false, message: `branch ${branch}에 커밋이 없습니다. 먼저 커밋하세요.` };
  }

  // 본문은 사람이 읽을 한 줄과 Linear 연결이면 충분하다. 변경 설명은 커밋 메시지가 이미 소유한다(AGENTS 21).
  const body = [
    issueUrl ?? verdict.issue,
    "",
    "CI가 초록이면 자동으로 병합됩니다. 병합 판정은 pull request의 `변경 검증` 하나가 합니다(ADR 0050).",
  ].join("\n");

  return {
    ok: true,
    issue: verdict.issue,
    steps: [
      { label: "push", command: "git", args: ["push", "--set-upstream", "origin", branch] },
      {
        label: "create",
        command: "gh",
        args: ["pr", "create", "--base", BASE_BRANCH, "--head", branch, "--title", subject, "--body", body],
        skipWhenPullRequestExists: true,
      },
      { label: "auto-merge", command: "gh", args: ["pr", "merge", branch, "--auto", "--merge"] },
    ],
  };
}

function run(worktreeRoot, command, args, { capture = false } = {}) {
  // shell을 거치지 않고 인자 배열로만 실행한다. 제목과 본문에 사용자 문자열이 들어가므로 하나의 명령
  // 문자열로 합치면 인용 규칙이 다른 Windows에서 그대로 명령 주입 경로가 된다.
  const result = spawnSync(command, args, {
    cwd: worktreeRoot,
    encoding: "utf8",
    shell: false,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command}을(를) 찾을 수 없습니다. GitHub CLI가 설치돼 있어야 합니다.`);
  }
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: String(result.stdout ?? "").trim() };
}

function pullRequestExists(worktreeRoot, branch) {
  return run(worktreeRoot, "gh", ["pr", "view", branch, "--json", "url"], { capture: true }).status === 0;
}

/** 계획을 실제로 실행한다. 실패한 단계에서 멈추고 그 단계의 exit code를 그대로 올린다. */
export async function runPullRequest({ cwd = process.cwd() } = {}) {
  const repository = targetRepositoryContext(cwd);
  const state = await loadState(repository.statePath);
  const claim = getWorktreeClaim(state, repository.worktreeRoot);
  const subject = run(repository.worktreeRoot, "git", ["log", "-1", "--format=%s"], { capture: true }).stdout;

  const plan = planPullRequest({ branch: repository.branch, claim, subject });
  if (!plan.ok) throw new Error(plan.message);

  for (const step of plan.steps) {
    if (step.skipWhenPullRequestExists && pullRequestExists(repository.worktreeRoot, repository.branch)) {
      process.stdout.write(`${plan.issue}의 pull request가 이미 있어 생성은 건너뜁니다.\n`);
      continue;
    }
    const { status } = run(repository.worktreeRoot, step.command, step.args);
    if (status !== 0) throw new Error(`${step.label} 단계가 실패했습니다(exit ${status}).`);
  }

  const url = run(repository.worktreeRoot, "gh", ["pr", "view", repository.branch, "--json", "url", "--jq", ".url"], { capture: true });
  process.stdout.write(`${url.stdout || plan.issue}\nCI가 초록이면 자동으로 병합됩니다.\n`);
}
