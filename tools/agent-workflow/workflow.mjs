/** @module 책임: hook 입력의 provider 중립 정규화와 Linear issue 식별자 추출, holder가 아닌 세션에도 여는 도구 목록을 순수하게 판정한다. */
import path from "node:path";

const ISSUE_IDENTIFIER = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i;

// 제어문자가 섞인 경로는 사람이 의도한 파일 이름이 아니다. 경로 판정을 시도하지 않고 거부한다.
function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export const FILE_EDIT_TOOLS = new Set(["apply_patch", "edit", "multiedit", "notebookedit", "write"]);

const SHELL_TOOLS = new Set(["bash", "exec_command", "powershell", "shell"]);

// holder가 아닌 세션은 "다른 writer가 잡은 작업은 read-only로 조사·review만 한다"(AGENTS 20)는 규칙의
// 대상이다. 저장소 파일에 닿지 않는 조회·탐색·대화 도구만 연다. 이름 목록이며 명령 본문은 해석하지 않는다.
const OBSERVER_TOOLS = new Set([
  "askuserquestion",
  "enterworktree",
  "exitworktree",
  "glob",
  "grep",
  "listagents",
  "ls",
  "notebookread",
  "read",
  "sendmessage",
  "toolsearch",
  "webfetch",
  "websearch",
]);

const LINEAR_READ_TOOL = /^mcp__linear__(?:get|list|search)_[a-z_]+$/i;

// 잠금을 넘겨받거나 상태를 보는 lifecycle 명령까지 막으면 막힌 세션은 사용자에게 명령을 대신 쳐 달라고
// 부탁하는 것 말고는 할 수 있는 일이 없다. 단일 `pnpm workflow:*` 명령만, chaining·redirect 없이 연다.
const WORKFLOW_COMMAND =
  /^\s*pnpm\s+(?:--dir(?:=|\s+)[^\s;&|<>`$]+\s+)?workflow:[a-z][a-z:-]*(?:\s+[^\s;&|<>`$]+)*\s*$/i;

function shellCommand(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  for (const key of ["command", "cmd", "script"]) {
    if (typeof toolInput[key] === "string") return toolInput[key];
  }
  return "";
}

export function toolIsOpenToObservers(toolName, toolInput = {}) {
  const normalizedName = String(toolName ?? "").toLowerCase();
  if (OBSERVER_TOOLS.has(normalizedName)) return true;
  if (LINEAR_READ_TOOL.test(normalizedName)) return true;
  if (SHELL_TOOLS.has(normalizedName)) return WORKFLOW_COMMAND.test(shellCommand(toolInput));
  return false;
}

export function extractIssueIdentifier(value) {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const identifier = extractIssueIdentifier(candidate);
      if (identifier) return identifier;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  return value.match(ISSUE_IDENTIFIER)?.[1]?.toUpperCase() ?? null;
}

/**
 * 편집 도구가 대상 파일을 담는 키는 provider마다 다르다. worklog가 서로 다른 키를 먼저 보면 도구마다
 * 기록한 파일이 갈라지므로 순서를 여기 하나로 모은다.
 */
export function editedPathCandidate(toolInput) {
  return (
    toolInput?.file_path ?? toolInput?.path ?? toolInput?.notebook_path ?? toolInput?.target_file ?? null
  );
}

/**
 * 저장소 밖 경로를 상대 경로로 판정하지 않는다. 상대 경로는 실행 cwd에 따라 다른 파일을 가리키므로
 * hook이 아는 worktree root 기준으로 해석하면 같은 문자열이 세션마다 다른 뜻이 된다.
 */
export function repositoryRelativePath(candidate, worktreeRoot) {
  if (typeof candidate !== "string" || candidate.length === 0 || hasControlCharacter(candidate)) {
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

export function normalizeHookEvent(input = {}) {
  const hookEventName =
    input.hook_event_name ?? input.hookEventName ?? input.event_name ?? input.eventName ?? input.event;
  const toolName = input.tool_name ?? input.toolName ?? input.tool?.name;
  const toolInput = input.tool_input ?? input.toolInput ?? input.tool?.input ?? {};
  // Claude Code hooks 문서의 PreToolUse 입력은 `initiated_by`("assistant" | "user")로 사용자가 직접
  // 실행한 도구 호출을 구분한다. 문자열이 아니면 빈 값으로 두어 agent 호출처럼 다룬다.
  const initiatedBy = input.initiated_by ?? input.initiatedBy;

  return {
    hookEventName: typeof hookEventName === "string" ? hookEventName : "Unknown",
    initiatedBy: typeof initiatedBy === "string" ? initiatedBy.toLowerCase() : "",
    sessionId: String(input.session_id ?? input.sessionId ?? "default"),
    toolInput,
    toolName: typeof toolName === "string" ? toolName : "",
  };
}
