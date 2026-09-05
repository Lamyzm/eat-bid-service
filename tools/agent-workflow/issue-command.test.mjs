import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseIssueCreateArguments,
  parseIssueListArguments,
  resolveIssueDescription,
  runIssueCreate,
  runIssueList,
} from "./issue-command.mjs";

const terminalStates = ["Done", "Canceled", "Duplicate"];

const defaults = { defaultProject: "R1 — 유료 투찰 Decision Loop", defaultState: "Ready" };

test("issue create는 제목을 요구하고 state와 project 기본값을 config에서 채운다", () => {
  const parsed = parseIssueCreateArguments(["--", "--title", "명단 정규화를 마저 한다"], defaults);

  assert.deepEqual(parsed, {
    description: null,
    descriptionFile: null,
    priority: null,
    projectName: "R1 — 유료 투찰 Decision Loop",
    stateName: "Ready",
    title: "명단 정규화를 마저 한다",
  });
});

test("issue create는 등호 형태와 명시적인 state·project·priority를 그대로 읽는다", () => {
  const parsed = parseIssueCreateArguments(
    ["--title=제목", "--state", "Backlog", "--project", "다른 project", "--priority=2"],
    defaults,
  );

  assert.deepEqual(parsed, {
    description: null,
    descriptionFile: null,
    priority: 2,
    projectName: "다른 project",
    stateName: "Backlog",
    title: "제목",
  });
});

test("issue create는 제목 누락과 범위 밖 priority와 본문 옵션 중복을 발행 전에 거부한다", () => {
  assert.throws(() => parseIssueCreateArguments([], defaults), /--title is required/);
  assert.throws(() => parseIssueCreateArguments(["--title", "  "], defaults), /--title is required/);
  assert.throws(
    () => parseIssueCreateArguments(["--title", "제목", "--priority", "0"], defaults),
    /--priority must be an integer from 1 to 4/,
  );
  assert.throws(
    () => parseIssueCreateArguments(["--title", "제목", "--priority", "5"], defaults),
    /--priority must be an integer from 1 to 4/,
  );
  assert.throws(
    () =>
      parseIssueCreateArguments(
        ["--title", "제목", "--description", "본문", "--description-file", "body.md"],
        defaults,
      ),
    /Choose either --description or --description-file/,
  );
  assert.throws(
    () => parseIssueCreateArguments(["--title", "제목", "--title", "다른 제목"], defaults),
    /--title may be given only once/,
  );
  assert.throws(
    () => parseIssueCreateArguments(["--title", "제목", "--force"], defaults),
    /Unknown issue option: --force/,
  );
  assert.throws(
    () => parseIssueCreateArguments(["--title", "제목", "EAT-53"], defaults),
    /issue create takes options only/,
  );
  assert.throws(
    () => parseIssueCreateArguments(["--title", "--state"], defaults),
    /--title requires a value/,
  );
});

test("issue create는 --description-file 값을 긴 옵션 이름으로 정확히 잘라 읽는다", () => {
  const parsed = parseIssueCreateArguments(
    ["--title", "제목", "--description-file", ".superpowers/body.md"],
    defaults,
  );

  assert.equal(parsed.descriptionFile, ".superpowers/body.md");
  assert.equal(parsed.description, null);
  assert.equal(
    resolveIssueDescription(parsed, () => "읽은 본문", [process.cwd()]),
    "읽은 본문",
  );
});

test("issue create 본문 파일은 작업 공간과 임시 디렉터리 안에서만 읽는다", () => {
  const worktree = path.resolve("F:/Project/eat-bid-service/.claude/worktrees/eat-53");
  const roots = [worktree, tmpdir()];
  const read = (file) => `읽음:${file}`;
  const parsedFor = (descriptionFile) => ({ description: null, descriptionFile });

  assert.match(
    resolveIssueDescription(parsedFor(path.join(worktree, "body.md")), read, roots),
    /^읽음:/,
  );
  assert.match(
    resolveIssueDescription(parsedFor(path.join(tmpdir(), "eat-53", "body.md")), read, roots),
    /^읽음:/,
  );

  let readCount = 0;
  const countingRead = (file) => {
    readCount += 1;
    return file;
  };
  for (const outside of [
    "C:/Users/kano/.infisical.json",
    path.join(worktree, "..", "..", "..", ".env"),
  ]) {
    assert.throws(
      () => resolveIssueDescription(parsedFor(outside), countingRead, roots),
      /--description-file must point inside the worktree, the repository or the temporary directory/,
      outside,
    );
  }
  assert.equal(readCount, 0);

  // 허용 루트를 하나도 알아내지 못하면 어떤 파일도 읽지 않는다.
  assert.throws(
    () => resolveIssueDescription(parsedFor("body.md"), countingRead, []),
    /--description-file must point inside/,
  );
  assert.equal(readCount, 0);
});

test("issue list는 기본으로 끝난 상태를 빼고 40건까지 읽는다", () => {
  assert.deepEqual(parseIssueListArguments([], { terminalStates }), {
    excludedStates: terminalStates,
    limit: 40,
    stateName: null,
  });
});

test("issue list에 상태를 지정하면 그 상태만 보고 제외 목록을 비운다", () => {
  assert.deepEqual(parseIssueListArguments(["--", "--state", "Done"], { terminalStates }), {
    excludedStates: [],
    limit: 40,
    stateName: "Done",
  });
});

test("issue list는 복잡도 상한을 넘는 limit과 알 수 없는 option을 거부한다", () => {
  assert.deepEqual(parseIssueListArguments(["--limit=10"], { terminalStates }).limit, 10);
  assert.throws(
    () => parseIssueListArguments(["--limit", "99"], { terminalStates }),
    /--limit must be an integer from 1 to 40/,
  );
  assert.throws(
    () => parseIssueListArguments(["--limit", "0"], { terminalStates }),
    /--limit must be an integer from 1 to 40/,
  );
  assert.throws(
    () => parseIssueListArguments(["--title", "제목"], { terminalStates }),
    /Unknown issue option: --title/,
  );
  assert.throws(
    () => parseIssueListArguments(["EAT-53"], { terminalStates }),
    /issue list takes options only/,
  );
});

test("issue list는 config의 team과 terminal 상태를 그대로 client에 넘기고 목록을 출력한다", async () => {
  const calls = [];
  const lines = [];
  const issues = await runIssueList({
    args: [],
    client: {
      listIssues: async (input) => {
        calls.push(input);
        return [{ identifier: "EAT-44", priority: 2, state: "Ready", title: "제목", updatedAt: null }];
      },
    },
    config: { teamKey: "EAT", terminalStates },
    write: (line) => lines.push(line),
  });

  assert.deepEqual(calls, [
    { excludedStates: terminalStates, limit: 40, stateName: null, teamKey: "EAT" },
  ]);
  assert.equal(issues.length, 1);
  assert.deepEqual(JSON.parse(lines.join(""))[0].identifier, "EAT-44");
});

test("issue create는 검증한 인자만 Linear client에 넘기고 식별자와 URL만 출력한다", async () => {
  const calls = [];
  const lines = [];
  const created = await runIssueCreate({
    allowedDescriptionRoots: [process.cwd()],
    args: ["--title", "검증용 issue", "--priority", "3", "--description-file", "body.md"],
    client: {
      createIssue: async (input) => {
        calls.push(input);
        return {
          id: "issue-uuid",
          identifier: "EAT-99",
          url: "https://linear.app/eatbid/issue/EAT-99",
        };
      },
    },
    config: {
      defaultProject: defaults.defaultProject,
      issueDefaultState: "Ready",
      teamKey: "EAT",
    },
    readFile: () => "본문 전체",
    write: (line) => lines.push(line),
  });

  assert.deepEqual(calls, [
    {
      description: "본문 전체",
      priority: 3,
      projectName: "R1 — 유료 투찰 Decision Loop",
      stateName: "Ready",
      teamKey: "EAT",
      title: "검증용 issue",
    },
  ]);
  assert.equal(created.identifier, "EAT-99");
  assert.deepEqual(JSON.parse(lines.join("")), {
    identifier: "EAT-99",
    url: "https://linear.app/eatbid/issue/EAT-99",
  });
});
