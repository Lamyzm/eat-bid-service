/** @module 책임: `workflow:issue`의 create·list 인자를 검증해 Linear 발행·조회 입력으로 바꾸고 결과 식별자와 목록만 표준 출력에 남긴다. */
import { readFileSync } from "node:fs";
import path from "node:path";

const TITLE_OPTION = "--title";
const DESCRIPTION_OPTION = "--description";
const DESCRIPTION_FILE_OPTION = "--description-file";
const PRIORITY_OPTION = "--priority";
const STATE_OPTION = "--state";
const PROJECT_OPTION = "--project";
const LIMIT_OPTION = "--limit";

// Linear GraphQL 복잡도 상한 때문에 한 번에 읽는 페이지를 40으로 고정한다. 더 필요하면 상태 필터로
// 좁히는 편이 맞고, 여기서 상한을 넘기면 조회 자체가 거부되어 목록이 아예 나오지 않는다.
const LIST_PAGE_MAXIMUM = 40;
const LIMIT_VALUE = /^[1-9][0-9]?$/;

// Linear priority는 0(없음)~4(Low)이며 agent가 스스로 발행하는 issue에 "없음"은 triage를 사람에게
// 다시 미루는 값이다. 그래서 실제로 순위를 정하는 1~4만 받는다.
const PRIORITY_VALUE = /^[1-4]$/;

// 옵션 이름은 긴 것부터 본다. `--description-file`을 `--description`으로 먼저 잘라내면 값이 `-file x`가 된다.
const CREATE_OPTIONS = [
  DESCRIPTION_FILE_OPTION,
  DESCRIPTION_OPTION,
  TITLE_OPTION,
  PRIORITY_OPTION,
  STATE_OPTION,
  PROJECT_OPTION,
];

const LIST_OPTIONS = [STATE_OPTION, LIMIT_OPTION];

function optionValue(args, index, option) {
  const argument = String(args[index]);
  return argument.includes("=") ? argument.slice(option.length + 1) : args[index + 1];
}

// 알 수 없는 option과 중복 지정과 값 없는 option을 여기서 모두 거부한다. subcommand별 허용 목록만
// 다르고 나머지 해석 규칙은 같아야, 새 option을 더할 때 한쪽에만 검증이 빠지는 일이 없다.
function collectOptions(args, allowedOptions, subcommand) {
  const values = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument === "--") continue;
    const option =
      allowedOptions.find((name) => argument === name || argument.startsWith(`${name}=`)) ?? null;
    if (option) {
      const value = optionValue(args, index, option);
      if (!argument.includes("=")) index += 1;
      if (value === undefined || String(value).startsWith("--")) {
        throw new Error(`${option} requires a value`);
      }
      if (values.has(option)) throw new Error(`${option} may be given only once`);
      values.set(option, String(value));
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown issue option: ${argument}`);
    positional.push(argument);
  }
  if (positional.length > 0) {
    throw new Error(`issue ${subcommand} takes options only, got: ${positional.join(" ")}`);
  }
  return values;
}

/**
 * 인자 해석은 발행 전에 끝난다. 잘못된 값을 Linear까지 들고 가면 절반만 채워진 issue가 남고, 그것을
 * 지우는 일은 agent가 아니라 사람에게 남는다. 그래서 필수·배타·범위를 여기서 모두 거부한다.
 */
export function parseIssueCreateArguments(args, { defaultProject = null, defaultState } = {}) {
  const values = collectOptions(args, CREATE_OPTIONS, "create");

  const title = values.get(TITLE_OPTION);
  if (!title || title.trim().length === 0) {
    throw new Error(`${TITLE_OPTION} is required for issue create`);
  }
  if (values.has(DESCRIPTION_OPTION) && values.has(DESCRIPTION_FILE_OPTION)) {
    throw new Error(`Choose either ${DESCRIPTION_OPTION} or ${DESCRIPTION_FILE_OPTION}`);
  }

  const priorityValue = values.get(PRIORITY_OPTION);
  if (priorityValue !== undefined && !PRIORITY_VALUE.test(priorityValue)) {
    throw new Error(`${PRIORITY_OPTION} must be an integer from 1 to 4`);
  }

  const stateName = values.get(STATE_OPTION) ?? defaultState;
  if (!stateName || stateName.trim().length === 0) {
    throw new Error(`${STATE_OPTION} is required when the workflow config has no default state`);
  }

  return {
    description: values.get(DESCRIPTION_OPTION) ?? null,
    descriptionFile: values.get(DESCRIPTION_FILE_OPTION) ?? null,
    priority: priorityValue === undefined ? null : Number(priorityValue),
    projectName: values.get(PROJECT_OPTION) ?? defaultProject,
    stateName,
    title,
  };
}

export function parseIssueListArguments(args, { terminalStates = [] } = {}) {
  const values = collectOptions(args, LIST_OPTIONS, "list");
  const limitValue = values.get(LIMIT_OPTION);
  if (limitValue !== undefined && !LIMIT_VALUE.test(limitValue)) {
    throw new Error(`${LIMIT_OPTION} must be an integer from 1 to ${LIST_PAGE_MAXIMUM}`);
  }
  const limit = limitValue === undefined ? LIST_PAGE_MAXIMUM : Number(limitValue);
  if (limit > LIST_PAGE_MAXIMUM) {
    throw new Error(`${LIMIT_OPTION} must be an integer from 1 to ${LIST_PAGE_MAXIMUM}`);
  }

  // 상태를 명시하면 그 상태만 본다. 끝난 issue를 확인할 방법을 남기면서도 기본 목록은 고를 수 있는
  // 것만 담기 위해, 기본에서만 terminal 상태를 뺀다.
  const stateName = values.get(STATE_OPTION) ?? null;
  return {
    excludedStates: stateName ? [] : terminalStates,
    limit,
    stateName,
  };
}

/**
 * 본문은 파일로 받는 경로를 기본으로 둔다. 여러 줄 한국어 본문을 shell 인자로 넘기면 따옴표·줄바꿈이
 * 플랫폼마다 다르게 잘린다.
 *
 * 다만 이 명령은 claim 없이 실행되고 읽은 내용을 그대로 Linear로 보낸다. 경로를 제한하지 않으면
 * `--description-file C:/Users/<사용자>/.infisical.json` 한 줄로 로컬 비밀 파일을 외부 서비스에
 * 올릴 수 있다. 그래서 작업 공간과 임시 디렉터리 안의 파일만 읽는다.
 */
export function resolveIssueDescription(
  parsed,
  readFile = (file) => readFileSync(file, "utf8"),
  allowedRoots = [],
) {
  if (!parsed.descriptionFile) return parsed.description;
  const file = path.resolve(parsed.descriptionFile);
  const roots = allowedRoots.filter((root) => typeof root === "string" && root.length > 0);
  const withinAllowedRoot = roots.some((root) => {
    const relative = path.relative(path.resolve(root), file);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!withinAllowedRoot) {
    throw new Error(
      `${DESCRIPTION_FILE_OPTION} must point inside the worktree, the repository or the temporary directory, got: ${file}`,
    );
  }
  return readFile(file);
}

export async function runIssueCreate({
  allowedDescriptionRoots = [],
  args,
  client,
  config,
  readFile,
  write = (line) => process.stdout.write(line),
}) {
  const parsed = parseIssueCreateArguments(args, {
    defaultProject: config.defaultProject ?? null,
    defaultState: config.issueDefaultState,
  });
  const created = await client.createIssue({
    description: resolveIssueDescription(parsed, readFile, allowedDescriptionRoots),
    priority: parsed.priority,
    projectName: parsed.projectName,
    stateName: parsed.stateName,
    teamKey: config.teamKey,
    title: parsed.title,
  });
  write(`${JSON.stringify({ identifier: created.identifier, url: created.url }, null, 2)}\n`);
  return created;
}

export async function runIssueList({
  args,
  client,
  config,
  write = (line) => process.stdout.write(line),
}) {
  const parsed = parseIssueListArguments(args, { terminalStates: config.terminalStates ?? [] });
  const issues = await client.listIssues({
    excludedStates: parsed.excludedStates,
    limit: parsed.limit,
    stateName: parsed.stateName,
    teamKey: config.teamKey,
  });
  write(`${JSON.stringify(issues, null, 2)}\n`);
  return issues;
}
