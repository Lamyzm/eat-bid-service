/** @module 책임: `workflow:issue create` 인자를 검증해 Linear 발행 입력으로 바꾸고 발행 결과 식별자만 표준 출력에 남긴다. */
import { readFileSync } from "node:fs";

const TITLE_OPTION = "--title";
const DESCRIPTION_OPTION = "--description";
const DESCRIPTION_FILE_OPTION = "--description-file";
const PRIORITY_OPTION = "--priority";
const STATE_OPTION = "--state";
const PROJECT_OPTION = "--project";

// Linear priority는 0(없음)~4(Low)이며 agent가 스스로 발행하는 issue에 "없음"은 triage를 사람에게
// 다시 미루는 값이다. 그래서 실제로 순위를 정하는 1~4만 받는다.
const PRIORITY_VALUE = /^[1-4]$/;

// 옵션 이름은 긴 것부터 본다. `--description-file`을 `--description`으로 먼저 잘라내면 값이 `-file x`가 된다.
const VALUE_OPTIONS = [
  DESCRIPTION_FILE_OPTION,
  DESCRIPTION_OPTION,
  TITLE_OPTION,
  PRIORITY_OPTION,
  STATE_OPTION,
  PROJECT_OPTION,
];

function optionValue(args, index, option) {
  const argument = String(args[index]);
  return argument.includes("=") ? argument.slice(option.length + 1) : args[index + 1];
}

function matchOption(argument) {
  return VALUE_OPTIONS.find((option) => argument === option || argument.startsWith(`${option}=`)) ?? null;
}

/**
 * 인자 해석은 발행 전에 끝난다. 잘못된 값을 Linear까지 들고 가면 절반만 채워진 issue가 남고, 그것을
 * 지우는 일은 agent가 아니라 사람에게 남는다. 그래서 필수·배타·범위를 여기서 모두 거부한다.
 */
export function parseIssueCreateArguments(args, { defaultProject = null, defaultState } = {}) {
  const values = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument === "--") continue;
    const option = matchOption(argument);
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
    throw new Error(`issue create takes options only, got: ${positional.join(" ")}`);
  }

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

/**
 * 본문은 파일로 받는 경로를 기본으로 둔다. 여러 줄 한국어 본문을 shell 인자로 넘기면 따옴표·줄바꿈이
 * 플랫폼마다 다르게 잘리고, hook 분류기도 그런 명령을 복합 명령으로 읽어 lease 없이는 막는다.
 */
export function resolveIssueDescription(parsed, readFile = (file) => readFileSync(file, "utf8")) {
  if (parsed.descriptionFile) return readFile(parsed.descriptionFile);
  return parsed.description;
}

export async function runIssueCreate({
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
    description: resolveIssueDescription(parsed, readFile),
    priority: parsed.priority,
    projectName: parsed.projectName,
    stateName: parsed.stateName,
    teamKey: config.teamKey,
    title: parsed.title,
  });
  write(`${JSON.stringify({ identifier: created.identifier, url: created.url }, null, 2)}\n`);
  return created;
}
