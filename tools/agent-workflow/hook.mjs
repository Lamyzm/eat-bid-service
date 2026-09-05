/** @module 책임: provider hook의 stdin·stdout·exit code 계약을 lease 판정 runtime에 연결하고 실패해도 fail-closed로 끝낸다. */
import { randomUUID } from "node:crypto";

import { handleHookEvent } from "./hook-runtime.mjs";
import { config, repositoryContext } from "./runtime.mjs";
import { withStateTransaction } from "./state-lock.mjs";
import { classifyToolCall, normalizeHookEvent } from "./workflow.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

let currentHookEventName = "";
async function main() {
  const input = await readStdinJson();
  currentHookEventName = String(input.hook_event_name ?? input.hookEventName ?? "");
  const normalizedEvent = normalizeHookEvent(input);
  const normalizedEventName = normalizedEvent.hookEventName.toLowerCase();
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  // repository context는 git을 세 번 실행한다. 읽기 도구까지 매번 그 비용을 내지 않도록 실제로 저장소
  // 경계를 알아야 하는 판정에서만 한 번 계산하고 이후 재사용한다.
  let repository = null;
  const resolveRepository = () => (repository ??= repositoryContext(cwd));
  if (
    (normalizedEventName === "pretooluse" || normalizedEventName === "posttooluse") &&
    !classifyToolCall(normalizedEvent.toolName, normalizedEvent.toolInput, {
      resolveWorktreeRoot: () => resolveRepository().worktreeRoot,
    }).mutatesRepository
  ) {
    return;
  }
  resolveRepository();
  let hookResult;
  await withStateTransaction(repository.statePath, async (state) => {
    hookResult = handleHookEvent({
      branch: repository.branch,
      config,
      createId: randomUUID,
      input,
      provider: argument("--provider", "unknown"),
      state,
      worktreeRoot: repository.worktreeRoot,
    });
    return hookResult.state;
  });

  // 차단(exit 2)은 stderr가 그대로 agent에게 전달되지만 통과(exit 0)는 그렇지 않다. 통과하면서
  // 알려야 할 내용은 hook JSON 계약의 `systemMessage`로만 나간다.
  if (hookResult.systemMessage) {
    process.stdout.write(`${JSON.stringify({ systemMessage: hookResult.systemMessage })}\n`);
  }
  if (hookResult.message) process.stderr.write(`${hookResult.message}\n`);
  process.exitCode = hookResult.exitCode;
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow hook failed safely: ${error?.message ?? String(error)}\n`);
  process.exitCode = currentHookEventName.toLowerCase() === "pretooluse" ? 2 : 1;
});
