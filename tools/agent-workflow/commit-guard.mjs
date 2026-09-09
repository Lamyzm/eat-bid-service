/** @module 책임: git commit·push 시점에 branch의 Linear issue와 worktree의 검증된 claim이 일치하는지 판정하고 push에서만 선택적으로 Linear에 재검증한다. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, linearClient, repositoryContext } from "./runtime.mjs";
import { getWorktreeClaim, loadState } from "./state.mjs";
import { extractIssueIdentifier } from "./workflow.mjs";

/**
 * issue branch의 커밋은 그 issue를 claim한 worktree에서만 만든다. issue 식별자가 없는 branch(main 같은
 * 통합 branch)는 검사하지 않는다. 통합 merge commit은 pre-commit을 거치지 않고, 사람이 직접 만드는
 * hotfix까지 claim을 요구하면 gate가 사람을 막는다.
 */
export function evaluateBranchClaim({ branch, claim }) {
  const issue = extractIssueIdentifier(branch);
  if (!issue) return { ok: true, issue: null, reason: "integration-branch" };
  if (!claim?.issueIdentifier) {
    return {
      ok: false,
      issue,
      reason: "claim-missing",
      message: `branch ${branch}는 ${issue} 작업인데 이 worktree에 claim이 없습니다. \`pnpm workflow:claim -- ${issue}\`를 실행한 뒤 다시 커밋하세요.`,
    };
  }
  if (claim.issueIdentifier !== issue) {
    return {
      ok: false,
      issue,
      reason: "claim-mismatch",
      message: `branch는 ${issue}, 이 worktree의 claim은 ${claim.issueIdentifier}입니다. \`pnpm workflow:claim -- ${issue}\`로 claim을 바꾸거나 ${claim.issueIdentifier} branch로 옮기세요.`,
    };
  }
  return { ok: true, issue, reason: "claim-matches" };
}

export function localBranchesFromPushStdin(stdin) {
  return String(stdin ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length));
}

/**
 * push는 커밋보다 드물고 원격에 닿는 행위라 Linear 재검증에 어울리는 시점이다. 다만 key는 Infisical
 * wrapper 안에서만 있으므로 key가 없으면 막지 않고 알린다. 기본 push 경로가 secret 주입을 요구하면
 * 모든 push가 wrapper 안에서만 가능해진다.
 */
export async function verifyClaimOnline({ claim, client, config: workflowConfig }) {
  const remote = await client.verifyIssueOwnership(claim.issueIdentifier, workflowConfig);
  if (remote.assigneeId && claim.assigneeId && remote.assigneeId !== claim.assigneeId) {
    return { ok: false, message: `Linear에서 ${claim.issueIdentifier}의 assignee가 바뀌었습니다: ${remote.assigneeName ?? remote.assigneeId}` };
  }
  return { ok: true, message: `Linear 재검증 통과: ${claim.issueIdentifier} (${remote.stateName})` };
}

export async function runCommitGuard({
  cwd = process.cwd(),
  environment = process.env,
  log = (line) => process.stderr.write(`${line}\n`),
  stage,
  stdin = "",
}) {
  const repository = repositoryContext(cwd);
  if (!repository.isGitWorktree) return 0;
  const state = await loadState(repository.statePath);
  const claim = getWorktreeClaim(state, repository.worktreeRoot);
  const branches = stage === "pre-push" ? localBranchesFromPushStdin(stdin) : [repository.branch];

  for (const branch of branches) {
    const verdict = evaluateBranchClaim({ branch, claim });
    if (!verdict.ok) {
      log(`eatbid ${stage}: ${verdict.message}`);
      return 1;
    }
    if (stage !== "pre-push" || !verdict.issue) continue;
    if (!environment.LINEAR_API_KEY) {
      log(`eatbid pre-push: ${verdict.issue} claim은 로컬 기록(${claim.verifiedAt ?? claim.claimedAt})만 확인했습니다. LINEAR_API_KEY가 없어 Linear 재검증은 생략합니다.`);
      continue;
    }
    const online = await verifyClaimOnline({ claim, client: linearClient(), config });
    log(`eatbid pre-push: ${online.message}`);
    if (!online.ok) return 1;
  }
  return 0;
}

async function main() {
  const stage = process.argv[2];
  if (stage !== "pre-commit" && stage !== "pre-push") {
    throw new Error(`Usage: node tools/agent-workflow/commit-guard.mjs pre-commit | pre-push (got ${stage ?? "nothing"})`);
  }
  let stdin = "";
  if (stage === "pre-push") {
    for await (const chunk of process.stdin) stdin += chunk;
  }
  process.exitCode = await runCommitGuard({ stage, stdin });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`eatbid commit guard failed: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
