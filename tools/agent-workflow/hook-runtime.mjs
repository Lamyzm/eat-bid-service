import path from "node:path";

import {
  enqueueEvent,
  getSessionState,
  getWorktreeLease,
  setWorktreeLease,
  updateSessionState,
} from "./state.mjs";
import {
  classifyToolCall,
  extractIssueIdentifier,
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
    const requestedIssue = extractIssueIdentifier(event.prompt);
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

    const leaseExpiresAt = lease?.expiresAt ? Date.parse(lease.expiresAt) : Number.NaN;
    if (!lease?.issueIdentifier || !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now().getTime()) {
      return {
        exitCode: 2,
        message:
          "Repository mutation blocked: create a verified Linear lease first with `pnpm workflow:claim -- EAT-123`. Read-only research and verification remain available.",
        state,
      };
    }

    const branchIssue = extractIssueIdentifier(branch);
    const mismatchedIssue = [branchIssue, session.requestedIssue].find(
      (identifier) => identifier && identifier !== lease.issueIdentifier,
    );
    if (mismatchedIssue) {
      return {
        exitCode: 2,
        message: `Repository mutation blocked: ${mismatchedIssue} does not match the verified lease ${lease.issueIdentifier}. Release or claim the intended issue explicitly.`,
        state,
      };
    }

    const requestedWriter = { provider, sessionId: event.sessionId };
    if (
      lease.writer &&
      (lease.writer.provider !== requestedWriter.provider ||
        lease.writer.sessionId !== requestedWriter.sessionId)
    ) {
      return {
        exitCode: 2,
        message: `Repository mutation blocked: the verified lease belongs to writing session ${lease.writer.provider}/${lease.writer.sessionId}. Release and claim explicitly to hand off.`,
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
      message: "",
      state: updateSessionState(claimedState, worktreeRoot, event.sessionId, {
        activeIssue: lease.issueIdentifier,
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
