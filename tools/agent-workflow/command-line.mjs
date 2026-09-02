/** @module 책임: workflow CLI 인자에서 Linear issue와 대상 worktree 경로를 분리해 경로 속 issue 모양 문자열이 claim 대상이 되지 않게 한다. */
import { extractIssueIdentifier } from "./workflow.mjs";

const WORKTREE_OPTION = "--worktree";

export function parseWorkflowArguments(args) {
  let worktreePath = null;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument === "--") continue;
    if (argument === WORKTREE_OPTION || argument.startsWith(`${WORKTREE_OPTION}=`)) {
      const value = argument.includes("=")
        ? argument.slice(WORKTREE_OPTION.length + 1)
        : args[(index += 1)];
      if (!value || String(value).startsWith("--")) {
        throw new Error(`${WORKTREE_OPTION} requires a worktree path`);
      }
      if (worktreePath) throw new Error(`${WORKTREE_OPTION} may be given only once`);
      worktreePath = String(value);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown workflow option: ${argument}`);
    positional.push(argument);
  }
  // worktree 경로(`.worktrees/eat-9-...`)에도 issue 모양 문자열이 들어가므로 positional에서만 issue를 찾는다.
  return { issueIdentifier: extractIssueIdentifier(positional), worktreePath };
}
