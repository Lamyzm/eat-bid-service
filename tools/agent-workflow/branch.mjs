/** @module 책임: claim이 요구한 브랜치로 대상 worktree를 옮길 때 미커밋 변경을 지키며 ref 생성과 checkout만 수행한다. */
import { spawnSync } from "node:child_process";

// shell을 거치지 않고 인자 배열로만 실행한다. 브랜치 이름은 사용자 입력이라 하나의 명령 문자열로
// 합치면 인용 규칙이 다른 Windows에서 그대로 명령 주입 경로가 된다.
function git(worktreeRoot, args) {
  const result = spawnSync("git", ["-C", worktreeRoot, ...args], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stderr: String(result.stderr ?? "").trim(),
    stdout: String(result.stdout ?? "").trim(),
  };
}

export function branchExists(worktreeRoot, branchName) {
  return git(worktreeRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`]).status === 0;
}

export function workingTreeIsDirty(worktreeRoot) {
  const status = git(worktreeRoot, ["status", "--porcelain"]);
  if (status.status !== 0) throw new Error(`git status in ${worktreeRoot} failed: ${status.stderr}`);
  return status.stdout.length > 0;
}

/**
 * 요청한 브랜치로 worktree를 옮기고 무엇을 했는지 돌려준다.
 *
 * 브랜치 전환은 추적 파일을 통째로 갈아끼우므로 미커밋 변경이 남아 있으면 claim 한 번이 다른 작업의
 * 결과를 조용히 삼킨다. 그래서 dirty worktree에서는 ref를 만들기 전에 멈추고 정리 책임을 돌려준다.
 */
export function checkoutClaimBranch(worktreeRoot, branchName, currentBranch) {
  if (currentBranch === branchName) return "unchanged";
  if (workingTreeIsDirty(worktreeRoot)) {
    throw new Error(
      `Worktree ${worktreeRoot} has uncommitted changes; commit or clean them before switching to ${branchName}`,
    );
  }

  const created = !branchExists(worktreeRoot, branchName);
  if (created) {
    const create = git(worktreeRoot, ["branch", branchName]);
    if (create.status !== 0) throw new Error(`git branch ${branchName} failed: ${create.stderr}`);
  }
  const checkout = git(worktreeRoot, ["checkout", branchName]);
  if (checkout.status !== 0) throw new Error(`git checkout ${branchName} failed: ${checkout.stderr}`);
  return created ? "created" : "switched";
}
