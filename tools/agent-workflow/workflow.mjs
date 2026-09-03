/** @module 책임: 에이전트 도구 호출의 변경 가능성과 Linear issue 식별자를 순수하게 판정한다. */
import { classifyCurl, classifyInlineInterpreter } from "./shell-read-only.mjs";

const ISSUE_IDENTIFIER = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i;

const FILE_EDIT_TOOLS = new Set([
  "apply_patch",
  "edit",
  "multiedit",
  "notebookedit",
  "write",
]);

const SHELL_TOOLS = new Set(["bash", "exec_command", "powershell", "shell"]);

const READ_ONLY_TOOLS = new Set(["glob", "grep", "read", "toolsearch", "webfetch", "websearch"]);

// worktree 진입·이탈은 tracked 파일이 아니라 세션 cwd만 바꾼다. lease는 worktree root 단위라 새
// worktree에는 lease가 없으므로 여기서 막으면 세션이 그 안에서 claim할 기회조차 얻지 못한다.
const WORKTREE_TOOLS = new Set(["enterworktree", "exitworktree"]);

// Linear MCP 도구 중 조회만 lease 없이 허용한다. 인계 절차가 "worklog 읽기 → claim" 순서이므로
// 읽기까지 막으면 받는 세션은 issue를 보기 전에 claim해야 한다.
const LINEAR_READ_TOOL = /^mcp__linear__(?:get|list|search)_[a-z_]+$/i;

// 브라우저 도구는 저장소 파일에 닿지 않는다. 화면 확인은 구현 중 검증의 일부라 lease 없이도 열되,
// 폼 입력·클릭·파일 업로드처럼 외부 상태를 바꾸는 상호작용은 계속 fail-closed로 둔다.
const CHROME_DEVTOOLS_READ_TOOL =
  /^mcp__chrome-devtools__(?:navigate_page|take_screenshot|take_snapshot|evaluate_script|list_pages|select_page|wait_for|list_console_messages|get_console_message|list_network_requests|get_network_request)$/i;

// 경로 인자는 공백 없는 토큰이나 큰따옴표 문자열만 허용한다. 치환·pipe 문자는 SHELL_COMPOSITION이
// 먼저 거르지만, 경로 자리에서 다른 토큰이 시작되지 않도록 여기서도 제외한다.
const PATH_ARGUMENT = String.raw`(?:"[^"|;&><$\x60\r\n]+"|[^\s|;&><$\x60"']+)`;
const ISSUE_ARGUMENT = String.raw`[A-Z][A-Z0-9]{1,9}-\d+`;

// `pnpm workflow:*`는 저장소 파일이 아니라 lease state·Linear·git worktree 목록만 바꾸며 lease를
// 만들고 푸는 유일한 경로다. 단일 명령 형태만 허용하고 pipe·chaining·redirect는 SHELL_COMPOSITION이
// 먼저 거른다. 인자는 issue 식별자, `--worktree <path>`, `worktree remove <path> | prune`뿐이다.
const WORKFLOW_LIFECYCLE_COMMAND = new RegExp(
  String.raw`^pnpm\s+workflow:[a-z][a-z:-]*(?:\s+(?:--|${ISSUE_ARGUMENT}|--worktree(?:=|\s+)${PATH_ARGUMENT}|remove\s+${PATH_ARGUMENT}|prune))*\s*$`,
  "i",
);

// kubectl 조회 subcommand는 cluster 상태를 읽을 뿐이다. exec·apply·delete·edit·patch처럼 cluster를
// 바꾸는 subcommand는 저장소 밖이라도 운영 사고가 되므로 lease 안에서만 실행한다.
const KUBECTL_READ_COMMAND = /^kubectl\s+(?:get|describe|logs|top)\b/;

// 다른 worktree를 조회할 때는 `git -C <path>` 형태가 기본이므로 같은 read-only subcommand를 허용한다.
// 소문자 `-c key=value`는 core.pager·diff.external 같은 config로 read-only subcommand 안에서 임의 실행을
// 일으키므로, git 정규식은 대소문자를 구분해 대문자 `-C`만 경로 prefix로 받는다.
const GIT_PATH_PREFIX = String.raw`(?:-C\s+${PATH_ARGUMENT}\s+)?`;

const MUTATING_COMMANDS = [
  /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch)\b/i,
  /(?:^|[;&|]\s*)(?:remove-item|move-item|copy-item|new-item|set-content|add-content|out-file)\b/i,
  /(?:^|[;&|]\s*)git\s+(?:add|commit|push|mv|rm|checkout|switch|reset|restore|rebase|merge|cherry-pick|tag)\b/i,
  /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)\s+(?:add|remove|install|uninstall|update|upgrade)\b/i,
  /(?:^|[;&|]\s*)sed\s+-[^\s]*i\b/i,
  /(^|[^<>])>(?![>=])/,
];

const READ_ONLY_COMMANDS = [
  /^rg\b/i,
  /^(?:get-content|get-childitem|test-path|select-string)\b/i,
  new RegExp(String.raw`^git\s+${GIT_PATH_PREFIX}(?:status|diff|log|show|rev-parse|worktree\s+(?:list|prune))\b`),
  new RegExp(String.raw`^git\s+${GIT_PATH_PREFIX}branch\s+--show-current\b`),
  KUBECTL_READ_COMMAND,
];

const SHELL_COMPOSITION = /[|;&><\r\n]|`|\$\(|(?:^|\s)(?:--fix|--write|--output(?:=|\s)|--ext-diff\b|--textconv\b|--pre(?:=|\s)|--update(?:-?snapshots?)?\b|--updateSnapshot\b|-u(?:\s|$))/i;

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

function shellCommand(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  for (const key of ["command", "cmd", "script"]) {
    if (typeof toolInput[key] === "string") return toolInput[key];
  }
  return "";
}

export function classifyToolCall(toolName, toolInput = {}) {
  const normalizedName = String(toolName ?? "").toLowerCase();

  if (FILE_EDIT_TOOLS.has(normalizedName)) {
    return { mutatesRepository: true, reason: "file-edit-tool" };
  }

  if (SHELL_TOOLS.has(normalizedName)) {
    const command = shellCommand(toolInput);
    // 인라인 코드는 따옴표 안 `;`가 chaining이 아니므로 SHELL_COMPOSITION보다 먼저 자기 규칙으로 판정한다.
    const inlineInterpreter = classifyInlineInterpreter(command);
    if (inlineInterpreter !== null) {
      return inlineInterpreter
        ? { mutatesRepository: false, reason: "inline-interpreter-read-only" }
        : { mutatesRepository: true, reason: "inline-interpreter-writes" };
    }
    if (SHELL_COMPOSITION.test(command)) {
      return { mutatesRepository: true, reason: "compound-or-writing-command" };
    }
    if (MUTATING_COMMANDS.some((pattern) => pattern.test(command))) {
      return { mutatesRepository: true, reason: "mutating-command" };
    }
    if (WORKFLOW_LIFECYCLE_COMMAND.test(command.trim())) {
      return { mutatesRepository: false, reason: "workflow-lifecycle-command" };
    }
    if (READ_ONLY_COMMANDS.some((pattern) => pattern.test(command.trim()))) {
      return { mutatesRepository: false, reason: "read-or-verification-command" };
    }
    const curl = classifyCurl(command);
    if (curl !== null) {
      return curl
        ? { mutatesRepository: false, reason: "curl-read-request" }
        : { mutatesRepository: true, reason: "curl-writes-or-uploads" };
    }
    return { mutatesRepository: true, reason: "unclassified-command-requires-claim" };
  }

  if (READ_ONLY_TOOLS.has(normalizedName)) {
    return { mutatesRepository: false, reason: "known-read-only-tool" };
  }

  if (WORKTREE_TOOLS.has(normalizedName)) {
    return { mutatesRepository: false, reason: "worktree-navigation-tool" };
  }

  if (LINEAR_READ_TOOL.test(normalizedName)) {
    return { mutatesRepository: false, reason: "linear-read-tool" };
  }

  if (CHROME_DEVTOOLS_READ_TOOL.test(normalizedName)) {
    return { mutatesRepository: false, reason: "browser-inspection-tool" };
  }

  return { mutatesRepository: true, reason: "unclassified-tool-requires-claim" };
}

export function normalizeHookEvent(input = {}) {
  const hookEventName =
    input.hook_event_name ?? input.hookEventName ?? input.event_name ?? input.eventName ?? input.event;
  const toolName = input.tool_name ?? input.toolName ?? input.tool?.name;
  const toolInput = input.tool_input ?? input.toolInput ?? input.tool?.input ?? {};
  const prompt = input.prompt ?? input.user_prompt ?? input.userPrompt ?? input.message;
  // Claude Code hooks 문서의 PreToolUse 입력은 `initiated_by`("assistant" | "user")로 사용자가 직접
  // 실행한 도구 호출을 구분한다. 문자열이 아니면 빈 값으로 두어 fail-closed로 agent 호출처럼 다룬다.
  const initiatedBy = input.initiated_by ?? input.initiatedBy;

  return {
    hookEventName: typeof hookEventName === "string" ? hookEventName : "Unknown",
    initiatedBy: typeof initiatedBy === "string" ? initiatedBy.toLowerCase() : "",
    prompt: typeof prompt === "string" ? prompt : "",
    sessionId: String(input.session_id ?? input.sessionId ?? "default"),
    toolInput,
    toolName: typeof toolName === "string" ? toolName : "",
  };
}
