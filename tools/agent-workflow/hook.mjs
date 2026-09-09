/** @module 책임: provider hook의 stdin·stdout·exit code 계약을 worktree holder 판정 runtime에 연결하고 쓰기가 필요할 때만 state lock을 잡는다. */
import { randomUUID } from "node:crypto";

import { handleHookEvent } from "./hook-runtime.mjs";
import { config, currentSessionIdentity, hookRepositoryContext } from "./runtime.mjs";
import { loadState } from "./state.mjs";
import { withStateTransaction } from "./state-lock.mjs";
import { normalizeHookEvent, toolIsOpenToObservers } from "./workflow.mjs";

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

function emit(result) {
  const output = {};
  if (result.systemMessage) output.systemMessage = result.systemMessage;
  if (Object.keys(output).length > 0) process.stdout.write(`${JSON.stringify(output)}\n`);
  // SessionStart와 UserPromptSubmit의 stdout은 세션 context에 들어간다. 잠금 결과는 그 경로로 알린다.
  if (result.context) process.stdout.write(`${result.context}\n`);
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exitCode = result.exitCode;
}

let currentHookEventName = "";
async function main() {
  const input = await readStdinJson();
  currentHookEventName = String(input.hook_event_name ?? input.hookEventName ?? "");
  const event = normalizeHookEvent(input);
  const eventName = event.hookEventName.toLowerCase();

  // 읽기 도구와 사용자가 직접 친 명령은 저장소 위치조차 계산하지 않는다. 매 도구 호출의 비용은 여기서 끝난다.
  if (
    eventName === "pretooluse" &&
    (event.initiatedBy === "user" || toolIsOpenToObservers(event.toolName, event.toolInput))
  ) {
    return;
  }

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const repository = hookRepositoryContext(cwd);
  if (!repository) return;

  const identity = currentSessionIdentity();
  const run = (state) =>
    handleHookEvent({
      config,
      createId: randomUUID,
      input,
      pid: identity.pid,
      provider: argument("--provider", "unknown"),
      state,
      worktreeRoot: repository.worktreeRoot,
    });

  // 판정은 lock 없이 읽은 state로 먼저 한다. 대부분의 호출은 holder가 자기 자신이라 쓸 것이 없고, 그때
  // lock을 잡으면 도구 호출마다 lock directory를 만들고 지우는 비용이 든다. 쓸 것이 있을 때만 transaction
  // 안에서 같은 판정을 다시 해 동시 hook의 갱신을 잃지 않는다.
  const snapshot = await loadState(repository.statePath);
  const preview = run(snapshot);
  if (preview.state === snapshot && preview.exitCode === 0) {
    emit(preview);
    return;
  }
  if (preview.exitCode !== 0) {
    emit(preview);
    return;
  }

  let result = preview;
  await withStateTransaction(repository.statePath, async (state) => {
    result = run(state);
    return result.state;
  });
  emit(result);
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow hook failed safely: ${error?.message ?? String(error)}\n`);
  process.exitCode = currentHookEventName.toLowerCase() === "pretooluse" ? 2 : 1;
});
