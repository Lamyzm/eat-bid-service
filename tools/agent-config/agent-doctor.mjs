/** @module 책임: Claude·Codex native hook adapter가 공통 runner에 연결됐는지와 리뷰 provider 상태를 비밀 없이 진단한다. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectReviewProviders } from "../review/review-doctor.mjs";

const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];
const RUNNER = /tools[\\/]agent-workflow[\\/]hook\.mjs/;

function hookSummary(target, { fileExists, readFile }) {
  if (!fileExists(target)) return { events: [], allCallRunner: false };
  let settings;
  try {
    settings = JSON.parse(readFile(target, "utf8"));
  } catch {
    return { events: [], allCallRunner: false };
  }
  const events = EVENTS.filter((event) => Array.isArray(settings?.hooks?.[event]));
  // 빈 배열의 every는 공허하게 참이므로 event마다 최소 한 hook이 실제로 runner를 불러야 한다.
  const allCallRunner =
    events.length === EVENTS.length &&
    events.every(
      (event) =>
        settings.hooks[event].length > 0 &&
        settings.hooks[event].every(
          (group) =>
            Array.isArray(group.hooks) &&
            group.hooks.length > 0 &&
            group.hooks.every((hook) => RUNNER.test(String(hook.command ?? ""))),
        ),
    );
  return { events, allCallRunner };
}

/**
 * repo-local `.codex/hooks.json` 로드 여부는 CLI capability이며 이 doctor는 파일 존재와 runner 연결만 본다.
 * 실제 지원은 사람이 `/hooks`에서 확인한 evidence로만 문서화한다.
 */
export function inspectAgentHooks({
  repoRoot,
  codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
  fileExists = existsSync,
  readFile = readFileSync,
} = {}) {
  const io = { fileExists, readFile };
  return {
    claudeProjectHook: hookSummary(path.join(repoRoot, ".claude", "settings.json"), io),
    codexReference: hookSummary(path.join(repoRoot, ".codex", "hooks.example.json"), io),
    codexRepoLocalHookFile: fileExists(path.join(repoRoot, ".codex", "hooks.json")),
    codexGlobalHookReferencesRunner: hookSummary(path.join(codexHome, "hooks.json"), io).allCallRunner,
    codexRepoLocalHookVerified: "unverified",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  process.stdout.write(
    `${JSON.stringify({ providers: inspectReviewProviders(), hooks: inspectAgentHooks({ repoRoot }) }, null, 2)}\n`,
  );
}
