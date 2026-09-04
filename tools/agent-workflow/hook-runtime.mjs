/** @module 책임: provider 중립 hook event를 worktree lease·writer 규칙에 대조해 차단 여부와 session worklog 전이를 결정한다. */
import path from "node:path";

import {
  enqueueEvent,
  getSessionState,
  getWorktreeLease,
  listWorktreeLeases,
  setWorktreeLease,
  updateSessionState,
} from "./state.mjs";
import {
  classifyToolCall,
  extractIssueIdentifier,
  extractPromptIssueIdentifier,
  normalizeHookEvent,
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

function repositoryRelativePath(candidate, worktreeRoot) {
  if (typeof candidate !== "string" || candidate.length === 0 || /[\u0000-\u001f\u007f]/u.test(candidate)) {
    return null;
  }
  const root = path.resolve(worktreeRoot);
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function changedPaths(toolName, toolInput, worktreeRoot) {
  const candidate =
    toolInput?.file_path ?? toolInput?.path ?? toolInput?.notebook_path ?? toolInput?.target_file;
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

  return ["bash", "exec_command", "powershell", "shell"].includes(String(toolName).toLowerCase())
    ? ["(shell mutation; inspect PR diff)"]
    : [];
}

// 차단 메시지에 어느 issue가 어느 worktree를 언제까지 잡고 있는지와 푸는 명령을 같이 적는다. 이것이
// 없으면 agent는 lease가 있는데 왜 막히는지 알 수 없고 사용자가 doctor를 대신 실행하게 된다.
function describeLeases(state, now) {
  const leases = listWorktreeLeases(state);
  if (leases.length === 0) return "";
  const nowMilliseconds = now().getTime();
  const lines = leases.map(({ lease, worktreeRoot }) => {
    const expiresAt = Date.parse(lease.expiresAt ?? "");
    const status = Number.isFinite(expiresAt) && expiresAt > nowMilliseconds ? "expires" : "expired";
    const writer = lease.writer ? `, writer ${lease.writer.provider}/${lease.writer.sessionId}` : "";
    return `  - ${lease.issueIdentifier} @ ${worktreeRoot} (${status} ${lease.expiresAt ?? "unknown"}${writer}) → \`pnpm workflow:release -- ${lease.issueIdentifier}\``;
  });
  return `\nCurrent leases:\n${lines.join("\n")}\nA lease whose worktree directory is gone is cleared by \`pnpm workflow:worktree prune\`.`;
}

// 왜 막혔는지만 적고 끝나면 세션이 할 수 있는 일은 사용자에게 명령을 대신 쳐 달라고 부탁하는 것뿐이다.
// lease가 정답인 모든 차단은 같은 한 줄로 끝나서 agent가 스스로 복구하도록 한다. 재claim은 만료를
// 늘리고 writer 결박을 새 세션으로 옮기므로 만료·branch 불일치·writer 충돌에 모두 맞는 명령이다.
function recoveryCommand(issueIdentifier) {
  return `\n지금 풀려면: \`pnpm workflow:claim -- ${issueIdentifier}\``;
}

export function finalizeSessionWorklog({
  createId,
  lease,
  now = () => new Date(),
  provider,
  sessionId,
  state,
  worktreeRoot,
}) {
  const session = getSessionState(state, worktreeRoot, sessionId);
  const activeIssue = session.activeIssue ?? lease?.issueIdentifier;
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

export function handleHookEvent({
  branch = "",
  config = {},
  createId,
  input,
  now = () => new Date(),
  provider = "unknown",
  state,
  worktreeRoot,
}) {
  const event = normalizeHookEvent(input);
  const session = getSessionState(state, worktreeRoot, event.sessionId);
  const lease = getWorktreeLease(state, worktreeRoot);
  const eventName = event.hookEventName.toLowerCase();

  if (eventName === "userpromptsubmit") {
    const requestedIssue = extractPromptIssueIdentifier(event.prompt);
    if (!requestedIssue) return { exitCode: 0, message: "", state };
    return {
      exitCode: 0,
      message: "",
      state: updateSessionState(state, worktreeRoot, event.sessionId, { requestedIssue }),
    };
  }

  if (eventName === "pretooluse") {
    const classification = classifyToolCall(event.toolName, event.toolInput);
    if (!classification.mutatesRepository) return { exitCode: 0, message: "", state };
    // lease는 agent가 남의 작업을 덮어쓰지 못하게 하는 규율이다. 사용자가 `!`로 직접 친 명령은
    // 사용자의 행위이므로 막지 않되, writer 결박이나 activeIssue 같은 agent 세션 상태도 바꾸지 않는다.
    if (event.initiatedBy === "user") return { exitCode: 0, message: "", state };

    const leaseExpiresAt = lease?.expiresAt ? Date.parse(lease.expiresAt) : Number.NaN;
    const leaseIsActive =
      Boolean(lease?.issueIdentifier) && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now().getTime();
    if (!leaseIsActive) {
      const reason = lease?.issueIdentifier
        ? `the Linear lease ${lease.issueIdentifier} for ${worktreeRoot} expired at ${lease.expiresAt ?? "unknown"}`
        : `create a verified Linear lease for ${worktreeRoot} first with \`pnpm workflow:claim -- EAT-123\``;
      const recovery = lease?.issueIdentifier ? recoveryCommand(lease.issueIdentifier) : "";
      return {
        exitCode: 2,
        message: `Repository mutation blocked: ${reason}. Read-only research and verification remain available.${describeLeases(state, now)}${recovery}`,
        state,
      };
    }

    // 브랜치는 커밋이 실제로 쌓이는 자리라 lease와 다르면 남의 작업을 오염시킨다. 여기서는 계속 막는다.
    const branchIssue = extractIssueIdentifier(branch);
    if (branchIssue && branchIssue !== lease.issueIdentifier) {
      return {
        exitCode: 2,
        message: `Repository mutation blocked: ${branchIssue} does not match the verified lease ${lease.issueIdentifier}. Release or claim the intended issue explicitly.${describeLeases(state, now)}${recoveryCommand(lease.issueIdentifier)}`,
        state,
      };
    }

    // 프롬프트에서 읽은 요청 이슈는 lease·branch가 이미 일치하면 소유권 근거가 아니라 잡음이다.
    // 차단하면 사용자가 채팅에 이슈 번호를 다시 쳐야만 풀리므로 경고만 남기고 lease를 정답으로 삼는다.
    const staleRequestedIssue =
      session.requestedIssue && session.requestedIssue !== lease.issueIdentifier
        ? session.requestedIssue
        : null;
    const message = staleRequestedIssue
      ? `경고: 요청 이슈 ${staleRequestedIssue}가 lease ${lease.issueIdentifier}와 다릅니다. lease를 따릅니다.`
      : "";

    const requestedWriter = { provider, sessionId: event.sessionId };
    if (
      lease.writer &&
      (lease.writer.provider !== requestedWriter.provider ||
        lease.writer.sessionId !== requestedWriter.sessionId)
    ) {
      return {
        exitCode: 2,
        message: `Repository mutation blocked: the verified lease belongs to writing session ${lease.writer.provider}/${lease.writer.sessionId}. Release and claim explicitly to hand off.${describeLeases(state, now)}${recoveryCommand(lease.issueIdentifier)}`,
        state,
      };
    }

    const claimedState = lease.writer
      ? state
      : setWorktreeLease(state, worktreeRoot, {
          ...lease,
          writer: {
            ...requestedWriter,
            boundAt: now().toISOString(),
          },
        });

    return {
      exitCode: 0,
      message,
      state: updateSessionState(claimedState, worktreeRoot, event.sessionId, {
        activeIssue: lease.issueIdentifier,
        ...(staleRequestedIssue ? { requestedIssue: lease.issueIdentifier } : {}),
      }),
    };
  }

  if (eventName === "posttooluse") {
    const classification = classifyToolCall(event.toolName, event.toolInput);
    if (!classification.mutatesRepository) return { exitCode: 0, message: "", state };
    const files = changedPaths(event.toolName, event.toolInput, worktreeRoot);
    if (files.length === 0) return { exitCode: 0, message: "", state };

    return {
      exitCode: 0,
      message: "",
      state: updateSessionState(state, worktreeRoot, event.sessionId, {
        changedFiles: [...new Set([...(session.changedFiles ?? []), ...files])],
      }),
    };
  }

  if (eventName === "stop" || eventName === "sessionend") {
    return {
      exitCode: 0,
      message: "",
      state: finalizeSessionWorklog({
        createId,
        lease,
        now,
        provider,
        sessionId: event.sessionId,
        state,
        worktreeRoot,
      }),
    };
  }

  return { exitCode: 0, message: "", state };
}
