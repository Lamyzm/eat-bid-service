import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLinearClient } from "./linear.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const config = JSON.parse(readFileSync(path.join(scriptDirectory, "config.json"), "utf8"));

function git(cwd, args, fallback = "") {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

export function repositoryContext(cwd) {
  const worktreeRoot = git(cwd, ["rev-parse", "--show-toplevel"], path.resolve(cwd));
  const gitCommonDirectory = git(worktreeRoot, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = path.isAbsolute(gitCommonDirectory)
    ? gitCommonDirectory
    : path.resolve(worktreeRoot, gitCommonDirectory || ".git");
  const statePath = process.env.EATBID_WORKFLOW_STATE_PATH
    ? path.resolve(process.env.EATBID_WORKFLOW_STATE_PATH)
    : path.join(commonDirectory, "eatbid-agent-workflow", "state.json");
  return {
    branch: git(worktreeRoot, ["branch", "--show-current"]),
    statePath,
    worktreeRoot,
  };
}

export function linearClient() {
  if (!process.env.LINEAR_API_KEY) {
    throw new Error("LINEAR_API_KEY is required for claim and sync commands");
  }
  return createLinearClient({
    apiKey: process.env.LINEAR_API_KEY,
    endpoint: config.linearEndpoint,
    fetchImpl: (url, request) =>
      fetch(url, { ...request, signal: AbortSignal.timeout(config.requestTimeoutMs) }),
  });
}
