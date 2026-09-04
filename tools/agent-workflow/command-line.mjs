/** @module 책임: workflow CLI 인자에서 Linear issue와 대상 worktree 경로와 브랜치·리뷰 의도를 분리해 경로 속 issue 모양 문자열이 claim 대상이 되지 않게 한다. */
import { extractIssueIdentifier } from "./workflow.mjs";

const BRANCH_OPTION = "--branch";
const REVIEW_OPTION = "--review";
const WORKTREE_OPTION = "--worktree";

// 브랜치 이름은 그대로 `git branch` 인자가 된다. shell을 거치지 않더라도 option 모양(`-f`)이나
// 상위 경로(`..`)는 git이 다른 뜻으로 읽으므로 ref 이름으로 안전한 모양만 통과시킨다.
const BRANCH_NAME = /^(?![-.])(?!.*\.\.)[A-Za-z0-9._/-]+$/;

function optionValue(args, index, option) {
  const argument = String(args[index]);
  return argument.includes("=") ? argument.slice(option.length + 1) : args[index + 1];
}

export function parseWorkflowArguments(args) {
  let branchName = null;
  let review = false;
  let worktreePath = null;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument === "--") continue;
    if (argument === REVIEW_OPTION) {
      review = true;
      continue;
    }
    if (argument === WORKTREE_OPTION || argument.startsWith(`${WORKTREE_OPTION}=`)) {
      const value = optionValue(args, index, WORKTREE_OPTION);
      if (!argument.includes("=")) index += 1;
      if (!value || String(value).startsWith("--")) {
        throw new Error(`${WORKTREE_OPTION} requires a worktree path`);
      }
      if (worktreePath) throw new Error(`${WORKTREE_OPTION} may be given only once`);
      worktreePath = String(value);
      continue;
    }
    if (argument === BRANCH_OPTION || argument.startsWith(`${BRANCH_OPTION}=`)) {
      const value = optionValue(args, index, BRANCH_OPTION);
      if (!argument.includes("=")) index += 1;
      if (!value || !BRANCH_NAME.test(String(value))) {
        throw new Error(`${BRANCH_OPTION} requires a git branch name`);
      }
      if (branchName) throw new Error(`${BRANCH_OPTION} may be given only once`);
      branchName = String(value);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown workflow option: ${argument}`);
    positional.push(argument);
  }
  // worktree 경로(`.worktrees/eat-9-...`)에도 issue 모양 문자열이 들어가므로 positional에서만 issue를 찾는다.
  return { branchName, issueIdentifier: extractIssueIdentifier(positional), review, worktreePath };
}
