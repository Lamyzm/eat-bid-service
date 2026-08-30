import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadState, saveState } from "./state.mjs";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function inspectDirectoryLock(lockPath) {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, lockPath };
    throw error;
  }

  let owner = null;
  try {
    owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  return {
    ageMs: Math.max(0, Date.now() - lockStat.mtimeMs),
    exists: true,
    lockPath,
    owner,
    ownerAlive: processIsAlive(owner?.pid),
  };
}

async function recoverDirectoryLock(
  lockPath,
  label,
  { now = () => new Date(), ownerlessStaleAfterMs = 10_000 } = {},
) {
  const lock = await inspectDirectoryLock(lockPath);
  if (!lock.exists) return { quarantinePath: null, recovered: false };
  if (lock.ownerAlive) {
    throw new Error(`Workflow ${label} lock is still active for PID ${lock.owner.pid}`);
  }
  if (!lock.owner && lock.ageMs < ownerlessStaleAfterMs) {
    throw new Error(
      `Workflow ${label} lock has no owner metadata but is not old enough to recover safely`,
    );
  }

  const timestamp = now().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const quarantinePath = `${lock.lockPath}.recovered-${timestamp}`;
  await rename(lock.lockPath, quarantinePath);
  return { quarantinePath, recovered: true };
}

export function inspectStateLock(statePath) {
  return inspectDirectoryLock(`${statePath}.lock`);
}

export function recoverStateLock(statePath, options) {
  return recoverDirectoryLock(`${statePath}.lock`, "state", options);
}

function workflowLockPath(statePath, name) {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error(`Invalid workflow lock name: ${name}`);
  return `${statePath}.${name}.lock`;
}

export function inspectWorkflowLock(statePath, name) {
  return inspectDirectoryLock(workflowLockPath(statePath, name));
}

export function recoverWorkflowLock(statePath, name, options) {
  return recoverDirectoryLock(workflowLockPath(statePath, name), name, options);
}

async function withDirectoryLock(
  lockPath,
  operation,
  { lockTimeoutMs = 3000, retryMs = 25 } = {},
) {
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(
          path.join(lockPath, "owner.json"),
          `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid })}\n`,
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        await rm(lockPath, { force: true, recursive: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= lockTimeoutMs) {
        throw new Error(`Timed out waiting for workflow state lock: ${lockPath}`);
      }
      await delay(retryMs);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

export async function withWorkflowLock(statePath, name, operation, options) {
  await mkdir(path.dirname(statePath), { recursive: true });
  return withDirectoryLock(workflowLockPath(statePath, name), operation, options);
}

export async function withStateTransaction(
  statePath,
  transaction,
  options,
) {
  await mkdir(path.dirname(statePath), { recursive: true });
  return withDirectoryLock(
    `${statePath}.lock`,
    async () => {
      const current = await loadState(statePath);
      const next = (await transaction(current)) ?? current;
      if (next !== current) await saveState(statePath, next);
      return next;
    },
    options,
  );
}
