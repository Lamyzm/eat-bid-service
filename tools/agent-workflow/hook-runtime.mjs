/** @module 책임: provider 중립 hook event를 worktree holder 규칙에 대조해 차단 여부와 session worklog 전이를 결정한다. */
import {
  blockedByHolderMessage,
  describeHolder,
  endWorktreeHolder,
  resolveWorktreeHolder,
} from "./session.mjs";
import {
  enqueueEvent,
  getSessionState,
  getWorktreeClaim,
  getWorktreeHolder,
  updateSessionState,
} from "./state.mjs";
import {
  FILE_EDIT_TOOLS,
  editedPathCandidate,
  normalizeHookEvent,
  repositoryRelativePath,
  toolIsOpenToObservers,
} from "./workflow.mjs";

function eventRecord({ createId, issueIdentifier, kind, now, provider, ...extra }) {
  return {
    id: createId(),
    issueIdentifier,
    kind,
    createdAt: now().toISOString(),
    provider,
    ...extra,
  };
}

function changedPaths(toolName, toolInput, worktreeRoot) {
  const candidate = editedPathCandidate(toolInput);
  if (typeof candidate === "string" && candidate.length > 0) {
    const normalized = repositoryRelativePath(candidate, worktreeRoot);
    return normalized ? [normalized] : [];
  }

  if (String(toolName).toLowerCase() === "apply_patch" && typeof toolInput?.command === "string") {
    return [...toolInput.command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => {
      const candidatePath = match[1].trim();
      return repositoryRelativePath(candidatePath, worktreeRoot);
    }).filter(Boolean);
  }

  return [];
}

export function finalizeSessionWorklog({
  claim,
  createId,
  now = () => new Date(),
  provider,
  sessionId,
  state,
  worktreeRoot,
}) {
  const session = getSessionState(state, worktreeRoot, sessionId);
  const activeIssue = claim?.issueIdentifier;
  const changedFiles = [...new Set(session.changedFiles ?? [])].sort();
  if (!activeIssue || changedFiles.length === 0) return state;

  let nextState = enqueueEvent(
    state,
    eventRecord({
      changedFiles,
      createId,
      issueIdentifier: activeIssue,
      kind: "worklog",
      now,
      provider,
    }),
  );
  nextState = updateSessionState(nextState, worktreeRoot, sessionId, { changedFiles: [] });
  return nextState;
}

const pass = (state) => ({ exitCode: 0, message: "", state });

export function handleHookEvent({
  config = {},
  createId,
  input,
  isProcessAlive,
  now = () => new Date(),
  pid = null,
  provider = "unknown",
  state,
  worktreeRoot,
}) {
  const event = normalizeHookEvent(input);
  const eventName = event.hookEventName.toLowerCase();
  const staleAfterMs = (config.sessionStaleMinutes ?? 30) * 60 * 1000;
  const identity = { isProcessAlive, now, pid, provider, sessionId: event.sessionId, staleAfterMs };
  const claim = getWorktreeClaim(state, worktreeRoot);

  if (eventName === "sessionstart") {
    const resolved = resolveWorktreeHolder(state, worktreeRoot, identity);
    // SessionStart는 차단할 수 없는 event다. 다른 세션이 잡고 있으면 그 사실을 context로 알려 세션이
    // 첫 쓰기에서 막히기 전에 다른 worktree로 옮길 수 있게 한다.
    const context =
      resolved.decision === "blocked"
        ? `eatbid workflow: ${blockedByHolderMessage(resolved.holder, worktreeRoot)}`
        : `eatbid workflow: 이 세션이 ${worktreeRoot}를 잡았습니다(${resolved.decision}). claim: ${claim?.issueIdentifier ?? "없음"}. 쓰기 전에 \`pnpm workflow:claim -- EAT-N\`으로 issue를 연결하세요.`;
    return { ...pass(resolved.nextState), context };
  }

  if (eventName === "pretooluse") {
    // 세션 잠금은 agent가 남의 worktree를 덮어쓰지 못하게 하는 규율이다. 사용자가 `!`로 직접 친 명령은
    // 사용자의 행위이므로 막지 않고, holder가 아닌 세션에도 열린 도구는 잠금을 보지 않는다.
    if (event.initiatedBy === "user") return pass(state);
    if (toolIsOpenToObservers(event.toolName, event.toolInput)) return pass(state);
    const resolved = resolveWorktreeHolder(state, worktreeRoot, identity);
    if (resolved.decision === "blocked") {
      return { exitCode: 2, message: blockedByHolderMessage(resolved.holder, worktreeRoot), state };
    }
    const result = pass(resolved.nextState);
    // 통과하는 호출의 stderr는 세션에 전달되지 않는다. 죽은 세션의 잠금을 넘겨받았다는 사실은 hook JSON의
    // `systemMessage`로만 세션이 읽는다.
    if (resolved.decision === "taken-over") {
      const previous = getWorktreeHolder(state, worktreeRoot);
      result.systemMessage = `eatbid workflow: 끝난 세션의 worktree 잠금을 넘겨받았습니다 (이전: ${describeHolder(previous)}).`;
    }
    return result;
  }

  if (eventName === "posttooluse") {
    if (!FILE_EDIT_TOOLS.has(String(event.toolName).toLowerCase())) return pass(state);
    const files = changedPaths(event.toolName, event.toolInput, worktreeRoot);
    if (files.length === 0) return pass(state);
    const session = getSessionState(state, worktreeRoot, event.sessionId);
    return pass(
      updateSessionState(state, worktreeRoot, event.sessionId, {
        changedFiles: [...new Set([...(session.changedFiles ?? []), ...files])],
      }),
    );
  }

  if (eventName === "userpromptsubmit") {
    const resolved = resolveWorktreeHolder(state, worktreeRoot, identity);
    return pass(resolved.decision === "blocked" ? state : resolved.nextState);
  }

  if (eventName === "stop" || eventName === "sessionend") {
    let nextState = finalizeSessionWorklog({
      claim,
      createId,
      now,
      provider,
      sessionId: event.sessionId,
      state,
      worktreeRoot,
    });
    if (eventName === "sessionend") {
      nextState = endWorktreeHolder(nextState, worktreeRoot, { now, provider, sessionId: event.sessionId });
    } else {
      const resolved = resolveWorktreeHolder(nextState, worktreeRoot, identity);
      if (resolved.decision !== "blocked") nextState = resolved.nextState;
    }
    return pass(nextState);
  }

  return pass(state);
}
