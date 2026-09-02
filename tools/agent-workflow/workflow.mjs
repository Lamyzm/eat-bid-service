/** @module 책임: 에이전트 도구 호출의 변경 가능성과 Linear issue 식별자를 순수하게 판정한다. */
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

// 경로 인자는 공백 없는 토큰이나 큰따옴표 문자열만 허용한다. 치환·pipe 문자는 SHELL_COMPOSITION이
// 먼저 거르지만, 경로 자리에서 다른 토큰이 시작되지 않도록 여기서도 제외한다.
const PATH_ARGUMENT = String.raw`(?:"[^"|;&><$\x60\r\n]+"|[^\s|;&><$\x60"']+)`;
const ISSUE_ARGUMENT = String.raw`[A-Z][A-Z0-9]{1,9}-\d+`;

// workflow lifecycle 명령은 저장소 파일이 아니라 lease state와 Linear만 바꾸며 lease를 만드는 유일한
// 경로다. 단일 명령 형태만 허용하고 pipe·chaining·redirect는 SHELL_COMPOSITION이 먼저 거른다.
// `--worktree <path>`는 세션 cwd와 다른 worktree의 lease를 다루는 유일한 인자다.
const WORKFLOW_LIFECYCLE_COMMAND = new RegExp(
  String.raw`^pnpm\s+workflow:(?:doctor(?::infisical)?|claim|sync|release|recover-lock)(?:\s+(?:--|${ISSUE_ARGUMENT}|--worktree(?:=|\s+)${PATH_ARGUMENT}))*\s*$`,
  "i",
);

// 다른 worktree를 조회할 때는 `git -C <path>` 형태가 기본이므로 같은 read-only subcommand를 허용한다.
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
  new RegExp(String.raw`^git\s+${GIT_PATH_PREFIX}(?:status|diff|log|show|rev-parse|worktree\s+list)\b`, "i"),
  new RegExp(String.raw`^git\s+${GIT_PATH_PREFIX}branch\s+--show-current\b`, "i"),
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

  return { mutatesRepository: true, reason: "unclassified-tool-requires-claim" };
}

export function normalizeHookEvent(input = {}) {
  const hookEventName =
    input.hook_event_name ?? input.hookEventName ?? input.event_name ?? input.eventName ?? input.event;
  const toolName = input.tool_name ?? input.toolName ?? input.tool?.name;
  const toolInput = input.tool_input ?? input.toolInput ?? input.tool?.input ?? {};
  const prompt = input.prompt ?? input.user_prompt ?? input.userPrompt ?? input.message;

  return {
    hookEventName: typeof hookEventName === "string" ? hookEventName : "Unknown",
    prompt: typeof prompt === "string" ? prompt : "",
    sessionId: String(input.session_id ?? input.sessionId ?? "default"),
    toolInput,
    toolName: typeof toolName === "string" ? toolName : "",
  };
}
