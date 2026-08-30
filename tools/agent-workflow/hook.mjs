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
  if (
    (normalizedEventName === "pretooluse" || normalizedEventName === "posttooluse") &&
    !classifyToolCall(normalizedEvent.toolName, normalizedEvent.toolInput).mutatesRepository
  ) {
    return;
  }
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const repository = repositoryContext(cwd);
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

  if (hookResult.message) process.stderr.write(`${hookResult.message}\n`);
  process.exitCode = hookResult.exitCode;
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow hook failed safely: ${error?.message ?? String(error)}\n`);
  process.exitCode = currentHookEventName.toLowerCase() === "pretooluse" ? 2 : 1;
});
