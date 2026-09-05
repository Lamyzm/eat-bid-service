/** @module 책임: 에이전트 도구 호출의 변경 가능성과 Linear issue 식별자를 순수하게 판정한다. */
import path from "node:path";

import { classifyCurl, classifyInlineInterpreter } from "./shell-read-only.mjs";

const ISSUE_IDENTIFIER = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i;

// 제어문자가 섞인 경로는 사람이 의도한 파일 이름이 아니다. 경로 판정을 시도하지 않고 거부한다.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

// 사용자가 실제로 요청한 이슈만 세션 상태에 남긴다. 브랜치 슬러그·경로·scratchpad 이름은 소문자
// `eat-34` 모양이라 대소문자를 구분하면 저절로 걸러지고, 경로 구분자·점·하이픈 뒤도 제외한다.
const PROMPT_ISSUE_IDENTIFIER = /(?<![\w/\\.-])([A-Z][A-Z0-9]{1,9}-\d+)(?![\w-])/;

// harness가 프롬프트에 끼워 넣는 블록은 사용자의 요청이 아니라 배경 정보다. 여기서 읽은 이슈 번호로
// 세션 요청 이슈를 바꾸면 다른 agent의 알림 한 줄이 이 세션의 lease 게이트를 잠근다.
const INJECTED_BLOCKS = [
  /<teammate-message[\s\S]*?<\/teammate-message>/g,
  /<cross-session-message[\s\S]*?<\/cross-session-message>/g,
  /<task-notification[\s\S]*?<\/task-notification>/g,
  /<system-reminder[\s\S]*?<\/system-reminder>/g,
  /\[SYSTEM NOTIFICATION[\s\S]*$/,
];

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

// 브랜치 이름과 경로 자리에서 option 토큰이 시작되지 않게 한다. `--force`나 `-D`가 경로처럼 통과하면
// 브랜치 생성 허용이 브랜치 삭제·강제 이동 허용으로 넓어진다.
const BRANCH_ARGUMENT = String.raw`(?!-)[A-Za-z0-9._/-]+`;
const NON_OPTION_PATH_ARGUMENT = String.raw`(?:"[^"|;&><$\x60\r\n]+"|(?!-)[^\s|;&><$\x60"']+)`;

// issue 제목·본문·project 이름은 사람이 읽는 한국어 문장이라 공백을 담는다. 따옴표 안이라도 치환·
// redirect·pipe 문자는 계속 제외해 "제목처럼 보이는 인자"가 새 명령을 여는 통로가 되지 않게 한다.
const TEXT_ARGUMENT = String.raw`(?:"[^"|;&><$\x60\r\n]*"|(?!-)[^\s|;&><$\x60"']+)`;

// `workflow:issue create`는 Linear에만 issue를 만들고 저장소 파일과 lease state를 건드리지 않는다.
// 아직 claim할 issue가 없는 세션이 실행하는 명령이므로 lease를 요구하면 자기 자신을 막는다.
const ISSUE_CREATE_ARGUMENT = String.raw`create|--title(?:=|\s+)${TEXT_ARGUMENT}|--description-file(?:=|\s+)${PATH_ARGUMENT}|--description(?:=|\s+)${TEXT_ARGUMENT}|--priority(?:=|\s+)[1-4]|--state(?:=|\s+)${TEXT_ARGUMENT}|--project(?:=|\s+)${TEXT_ARGUMENT}`;

// `pnpm workflow:*`는 저장소 파일이 아니라 lease state·Linear·git worktree 목록만 바꾸며 lease를
// 만들고 푸는 유일한 경로다. 단일 명령 형태만 허용하고 chaining·redirect는 SHELL_COMPOSITION이,
// pipe는 출력 필터 판정이 먼저 거른다. 인자는 issue 식별자, `--worktree <path>`,
// `worktree remove <path> | prune`, `issue create`의 발행 option뿐이다.
const WORKFLOW_LIFECYCLE_COMMAND = new RegExp(
  String.raw`^pnpm\s+workflow:[a-z][a-z:-]*(?:\s+(?:--|${ISSUE_ARGUMENT}|--worktree(?:=|\s+)${PATH_ARGUMENT}|--branch(?:=|\s+)${BRANCH_ARGUMENT}|--review|remove\s+${PATH_ARGUMENT}|prune|${ISSUE_CREATE_ARGUMENT}))*\s*$`,
  "i",
);

// 폴더 생성·목록은 비밀값을 읽지도 쓰지도 않고 저장소 파일도 바꾸지 않는다. 값을 다루는
// `infisical secrets set|get|list`와 임의 프로그램을 실행하는 `infisical run`은 여기에 넣지 않는다.
// 값 출력은 transcript 유출이고, `secrets set`은 kubectl 변경 subcommand와 같은 운영 사고 범주이며,
// `run -- node <script>`는 주입된 key로 저장소 파일을 바꿀 수 있기 때문이다.
const SECRET_FOLDER_COMMAND = new RegExp(
  String.raw`^infisical\s+secrets\s+folders\s+(?:create|list)(?:\s+${PATH_ARGUMENT})*\s*$`,
  "i",
);

// 브랜치 생성과 worktree 추가는 새 ref와 새 디렉터리를 만들 뿐 추적 파일 내용을 바꾸지 않는다.
// lease 없이 이것마저 막으면 claim 전에 올바른 브랜치로 옮길 방법이 없어 이슈 전환이 교착한다.
// `checkout -b`·`switch -c`는 start-point를 주면 그 commit의 tree로 작업 파일을 갈아끼우므로 이름
// 하나만 받는 형태(현재 HEAD 기준)까지만 허용한다. `git branch <name> [<start>]`는 HEAD를 옮기지
// 않는 순수 ref 생성이라 start-point가 있어도 허용한다.
const WORKTREE_ADD_ARGUMENT = String.raw`(?:--quiet|--detach|-b\s+${BRANCH_ARGUMENT}|${NON_OPTION_PATH_ARGUMENT})`;
const BRANCH_CREATION_COMMAND = new RegExp(
  String.raw`^git\s+(?:branch\s+${BRANCH_ARGUMENT}(?:\s+${BRANCH_ARGUMENT})?|(?:checkout\s+-b|switch\s+-c)\s+${BRANCH_ARGUMENT}|worktree\s+add(?:\s+${WORKTREE_ADD_ARGUMENT})+)\s*$`,
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

// pipe는 여기서 빼고 따로 다룬다. `pnpm workflow:release -- EAT-37 | tail`처럼 결과를 줄여 읽는
// 형태까지 unclassified로 막으면 lease를 푸는 명령 자체가 lease를 요구하게 된다(EAT-52).
const SHELL_COMPOSITION = /[;&><\r\n]|`|\$\(|(?:^|\s)(?:--fix|--write|--output(?:=|\s)|--ext-diff\b|--textconv\b|--pre(?:=|\s)|--update(?:-?snapshots?)?\b|--updateSnapshot\b|-u(?:\s|$))/i;

// pipe 뒤에 올 수 있는 것은 표준 입력을 줄이거나 모양만 바꾸는 필터뿐이다. 파일을 쓰거나(`tee`,
// `sort -o`) 다른 프로그램을 실행하는(`xargs`, `ForEach-Object`) 단계는 여기에 넣지 않는다.
const PIPELINE_FILTER_COMMAND =
  /^(?:head|tail|wc|uniq|cut|tr|nl|cat|grep|rg|jq|select-object|select-string|measure-object|sort-object|format-list|format-table|out-string|convertto-json)\b/i;

/**
 * pipe만 붙은 명령을 앞 단계 하나로 줄인다. 뒤 단계가 전부 순수 출력 필터일 때만 앞 단계를 돌려주고,
 * 하나라도 아니면 `null`로 fail-closed한다. `||`는 빈 단계를 만들어 자동으로 여기서 걸린다.
 */
export function reduceReadOnlyPipeline(command) {
  if (!command.includes("|")) return command;
  const [head, ...filters] = command.split("|");
  if (filters.length === 0) return command;
  const allFiltersAreReadOnly = filters.every((filter) => PIPELINE_FILTER_COMMAND.test(filter.trim()));
  return allFiltersAreReadOnly ? head : null;
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

export function extractPromptIssueIdentifier(prompt) {
  if (typeof prompt !== "string") return null;
  const authored = INJECTED_BLOCKS.reduce((text, block) => text.replace(block, " "), prompt);
  return authored.match(PROMPT_ISSUE_IDENTIFIER)?.[1] ?? null;
}

/**
 * 저장소 밖 경로를 상대 경로로 판정하지 않는다. 상대 경로는 실행 cwd에 따라 다른 파일을 가리키므로
 * hook이 아는 worktree root 기준으로 해석하면 같은 문자열이 세션마다 다른 뜻이 된다.
 */
export function repositoryRelativePath(candidate, worktreeRoot) {
  if (typeof candidate !== "string" || candidate.length === 0 || CONTROL_CHARACTER.test(candidate)) {
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

// 편집 도구가 저장소 밖 절대 경로를 가리키면 lease가 지키려는 대상이 아니다. Claude memory 디렉터리나
// scratchpad에 쓰는 일까지 막으면 세션은 claim 없이 자기 기록조차 남기지 못한다. root를 알 수 없거나
// 경로가 없으면 저장소 안으로 간주해 계속 fail-closed한다.
function editsOutsideRepository(toolInput, resolveWorktreeRoot) {
  if (typeof resolveWorktreeRoot !== "function") return false;
  const candidate =
    toolInput?.file_path ?? toolInput?.notebook_path ?? toolInput?.target_file ?? toolInput?.path;
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return false;
  let worktreeRoot;
  try {
    worktreeRoot = resolveWorktreeRoot();
  } catch {
    return false;
  }
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) return false;
  return repositoryRelativePath(candidate, worktreeRoot) === null;
}

function shellCommand(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  for (const key of ["command", "cmd", "script"]) {
    if (typeof toolInput[key] === "string") return toolInput[key];
  }
  return "";
}

// pipe를 걷어낸 뒤 남은 한 단계를 판정한다. 순서는 "위험한 형태 먼저, 허용 목록 나중"이며 pipe만
// 여기 오기 전에 처리된다. 앞 단계가 쓰는 명령이면 뒤가 필터여도 그대로 mutation으로 남는다.
function classifyShellStage(command) {
  if (BRANCH_CREATION_COMMAND.test(command.trim())) {
    return { mutatesRepository: false, reason: "branch-creation-command" };
  }
  if (MUTATING_COMMANDS.some((pattern) => pattern.test(command))) {
    return { mutatesRepository: true, reason: "mutating-command" };
  }
  if (WORKFLOW_LIFECYCLE_COMMAND.test(command.trim())) {
    return { mutatesRepository: false, reason: "workflow-lifecycle-command" };
  }
  if (SECRET_FOLDER_COMMAND.test(command.trim())) {
    return { mutatesRepository: false, reason: "secret-folder-command" };
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

export function classifyToolCall(toolName, toolInput = {}, { resolveWorktreeRoot = null } = {}) {
  const normalizedName = String(toolName ?? "").toLowerCase();

  if (FILE_EDIT_TOOLS.has(normalizedName)) {
    return editsOutsideRepository(toolInput, resolveWorktreeRoot)
      ? { mutatesRepository: false, reason: "file-edit-outside-repository" }
      : { mutatesRepository: true, reason: "file-edit-tool" };
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
    // chaining·redirect·치환은 pipe를 나누기 전에 명령 전체에서 본다. 뒤 단계에만 있는 `> out.log`가
    // 앞 단계 판정으로 통과하면 pipe 완화가 그대로 파일 쓰기 허용이 된다.
    if (SHELL_COMPOSITION.test(command)) {
      return { mutatesRepository: true, reason: "compound-or-writing-command" };
    }
    const stage = reduceReadOnlyPipeline(command);
    if (stage === null) return { mutatesRepository: true, reason: "compound-or-writing-command" };
    return classifyShellStage(stage);
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
