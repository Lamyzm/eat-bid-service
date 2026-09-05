import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyToolCall,
  extractIssueIdentifier,
  extractPromptIssueIdentifier,
  splitPipelineStages,
} from "./workflow.mjs";

const REPOSITORY_ROOT = "F:/Project/eat-bid-service/.claude/worktrees/eat-53-agent-self-service";
const insideRepository = { resolveWorktreeRoot: () => REPOSITORY_ROOT };

test("extractIssueIdentifier는 Linear 식별자를 정규화하고 일반 문장의 하이픈은 무시한다", () => {
  assert.equal(extractIssueIdentifier("eat-42 작업을 시작해줘"), "EAT-42");
  assert.equal(extractIssueIdentifier("문서만 읽어줘"), null);
  assert.equal(extractIssueIdentifier("2026-08-30 계획"), null);
});

test("extractIssueIdentifier는 pnpm 구분자를 건너뛰고 claim 인자에서 이슈를 찾는다", () => {
  assert.equal(extractIssueIdentifier(["--", "eat-11"]), "EAT-11");
  assert.equal(extractIssueIdentifier(["EAT-11"]), "EAT-11");
  assert.equal(extractIssueIdentifier(["--"]), null);
});

test("프롬프트 추출은 대문자 EAT-N만 인정하고 경로의 eat-34는 무시한다", () => {
  assert.equal(
    extractPromptIssueIdentifier(
      "C:/Temp/claude/F--Project-eat-bid-service--worktrees-eat-34-collection-modes/scratchpad",
    ),
    null,
  );
  assert.equal(extractPromptIssueIdentifier("EAT-37 진행"), "EAT-37");
  assert.equal(extractPromptIssueIdentifier("F:/Project/eat-bid-service/docs/EAT-37/plan.md"), null);
  assert.equal(extractPromptIssueIdentifier("문서만 읽어줘"), null);
  assert.equal(extractPromptIssueIdentifier(42), null);
});

test("teammate·알림·system-reminder·skill 목록 블록 안의 이슈 번호는 무시한다", () => {
  assert.equal(
    extractPromptIssueIdentifier(
      '<teammate-message teammate_id="lead">EAT-34를 계속</teammate-message> EAT-37 진행',
    ),
    "EAT-37",
  );
  assert.equal(
    extractPromptIssueIdentifier("<task-notification>agent가 EAT-34를 끝냈다</task-notification>"),
    null,
  );
  assert.equal(
    extractPromptIssueIdentifier("[SYSTEM NOTIFICATION - NOT USER INPUT]\nEAT-34 리뷰가 끝났다"),
    null,
  );
  assert.equal(
    extractPromptIssueIdentifier("<system-reminder>skill 목록에 EAT-34가 있다</system-reminder>"),
    null,
  );
  assert.equal(
    extractPromptIssueIdentifier("<cross-session-message>EAT-34</cross-session-message>"),
    null,
  );
});

test("속성이 붙은 주입 블록도 이슈 번호를 숨기지 못한다", () => {
  assert.equal(
    extractPromptIssueIdentifier(
      '<task-notification id="7" agent="impl">EAT-34가 끝났다</task-notification>',
    ),
    null,
  );
  assert.equal(
    extractPromptIssueIdentifier('<system-reminder priority="high">EAT-34 참고</system-reminder>'),
    null,
  );
  assert.equal(
    extractPromptIssueIdentifier(
      '<system-reminder priority="high">EAT-34 참고</system-reminder> EAT-41 진행',
    ),
    "EAT-41",
  );
});

test("브랜치 추출은 소문자 슬러그를 그대로 인정한다", () => {
  assert.equal(extractIssueIdentifier("eat-37-org-attempts"), "EAT-37");
  assert.equal(extractPromptIssueIdentifier("eat-37-org-attempts"), null);
});

test("저장소 편집 도구는 차단하고 명시적인 읽기 도구만 허용한다", () => {
  assert.deepEqual(classifyToolCall("Edit", { file_path: "src/a.ts" }), {
    mutatesRepository: true,
    reason: "file-edit-tool",
  });
  assert.deepEqual(classifyToolCall("apply_patch", {}), {
    mutatesRepository: true,
    reason: "file-edit-tool",
  });
  assert.deepEqual(classifyToolCall("Read", { file_path: "src/a.ts" }), {
    mutatesRepository: false,
    reason: "known-read-only-tool",
  });
  assert.deepEqual(classifyToolCall("Bash", { command: "rg -n TODO src" }), {
    mutatesRepository: false,
    reason: "read-or-verification-command",
  });
});

test("분류되지 않은 도구와 MCP 도구는 변경 가능성이 있는 것으로 안전하게 차단한다", () => {
  for (const toolName of ["UnknownTool", "mcp__filesystem__write_file", "future_mutator"]) {
    assert.deepEqual(classifyToolCall(toolName, {}), {
      mutatesRepository: true,
      reason: "unclassified-tool-requires-claim",
    });
  }
});

test("classifyToolCall은 일반적인 PowerShell과 shell과 package와 git 변경을 인식한다", () => {
  const mutations = [
    ["Bash", { command: "git commit -m change" }],
    ["exec_command", { cmd: "Set-Content -Path a.txt -Value x" }],
    ["Bash", { command: "pnpm add zod" }],
    ["Bash", { command: "echo x > a.txt" }],
    ["Bash", { command: "rm a.txt" }],
  ];

  for (const [toolName, input] of mutations) {
    assert.equal(classifyToolCall(toolName, input).mutatesRepository, true, JSON.stringify(input));
  }
});

test("알 수 없는 shell 명령은 claim이 필요하고 좁은 읽기 허용목록만 열린다", () => {
  assert.equal(classifyToolCall("Bash", { command: "node scripts/generate.mjs" }).mutatesRepository, true);
  assert.equal(classifyToolCall("Bash", { command: "python script.py" }).mutatesRepository, true);
  assert.equal(classifyToolCall("Bash", { command: "rg -n TODO src" }).mutatesRepository, false);
  assert.equal(classifyToolCall("Bash", { command: "git status --short" }).mutatesRepository, false);
});

test("읽기 명령 prefix로 복합 명령과 pipe와 snapshot 쓰기를 숨길 수 없다", () => {
  const bypasses = [
    "rg TODO src | node scripts/write.mjs",
    "git status --short && python writer.py",
    "pnpm test -- --updateSnapshot",
    "pnpm test -u",
    "git diff`npython writer.py",
    "git diff --output=review.patch",
    "git show --ext-diff HEAD",
    "git diff --textconv HEAD",
    "rg --pre 'node tools/write-side-effect.mjs' TODO .",
  ];

  for (const command of bypasses) {
    assert.equal(
      classifyToolCall("Bash", { command }).mutatesRepository,
      true,
      command,
    );
  }
});

test("workflow lifecycle 명령은 lease 없이 허용하고 pipe나 redirect가 붙으면 계속 차단한다", () => {
  for (const command of [
    "pnpm workflow:doctor",
    "pnpm workflow:doctor:infisical",
    "pnpm workflow:claim -- EAT-26",
    "pnpm workflow:claim EAT-26",
    "pnpm workflow:sync",
    "pnpm workflow:release",
    "pnpm workflow:release -- EAT-36",
    "pnpm workflow:recover-lock",
    "pnpm workflow:test",
    "pnpm workflow:worktree remove .worktrees/eat-36-decision-shell",
    "pnpm workflow:worktree -- remove F:/Project/eat-bid-service/.worktrees/eat-36-decision-shell",
    "pnpm workflow:worktree prune",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "workflow-lifecycle-command" },
      command,
    );
  }
  for (const command of [
    "pnpm workflow:claim -- EAT-26 && rm -rf src",
    "pnpm workflow:doctor > doctor.json",
    "pnpm workflow:claim -- EAT-26; echo done",
    "pnpm workflow:worktree remove $(pwd)",
    "pnpm workflow:worktree remove ../a ../b",
    "pnpm workflow:test -- --test-name-pattern x",
    "pnpm workflow-test",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("Linear MCP 읽기 도구와 ToolSearch는 허용하고 Linear 쓰기 도구는 계속 차단한다", () => {
  for (const toolName of [
    "mcp__linear__get_issue",
    "mcp__linear__list_comments",
    "mcp__linear__search_documentation",
  ]) {
    assert.deepEqual(
      classifyToolCall(toolName, {}),
      { mutatesRepository: false, reason: "linear-read-tool" },
      toolName,
    );
  }
  assert.deepEqual(classifyToolCall("ToolSearch", { query: "select:mcp__linear__get_issue" }), {
    mutatesRepository: false,
    reason: "known-read-only-tool",
  });
  for (const toolName of [
    "mcp__linear__save_issue",
    "mcp__linear__save_comment",
    "mcp__linear__delete_comment",
  ]) {
    assert.equal(classifyToolCall(toolName, {}).mutatesRepository, true, toolName);
  }
});

test("Linear MCP의 issue·댓글 생성은 lease 없이 허용하고 상태 전환과 삭제는 계속 차단한다", () => {
  for (const toolName of ["mcp__linear__create_issue", "mcp__linear__create_comment"]) {
    assert.deepEqual(
      classifyToolCall(toolName, {}),
      { mutatesRepository: false, reason: "linear-issue-bootstrap-tool" },
      toolName,
    );
  }
  for (const toolName of [
    "mcp__linear__update_issue",
    "mcp__linear__create_project",
    "mcp__linear__delete_issue",
  ]) {
    assert.equal(classifyToolCall(toolName, {}).mutatesRepository, true, toolName);
  }
});

test("worktree 진입·이탈 도구와 git worktree 조회는 lease 없이 허용하고 worktree 변경은 차단한다", () => {
  for (const toolName of ["EnterWorktree", "ExitWorktree"]) {
    assert.deepEqual(
      classifyToolCall(toolName, { name: "eat-27-agent-worktree-lease" }),
      { mutatesRepository: false, reason: "worktree-navigation-tool" },
      toolName,
    );
  }
  for (const command of ["git worktree list", "git worktree list --porcelain", "git worktree prune"]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "read-or-verification-command" },
      command,
    );
  }
  for (const command of ["git worktree remove .worktrees/x", "git worktree prune && rm -rf .worktrees/x"]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("브랜치를 만드는 git 명령은 lease 없이 허용하고 파일을 바꾸는 git 명령은 계속 차단한다", () => {
  for (const command of [
    "git branch eat-41-lease-gate",
    "git checkout -b eat-41-lease-gate",
    "git switch -c eat-41-lease-gate",
    "git branch eat-41-lease-gate main",
    "git checkout -b x",
    "git worktree add .worktrees/eat-41 -b eat-41-lease-gate",
    "git worktree add --quiet .worktrees/eat-41 eat-41-lease-gate",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "branch-creation-command" },
      command,
    );
  }
  for (const command of [
    "git checkout main",
    "git switch main",
    "git branch -D eat-41-lease-gate",
    "git branch -m old-name new-name",
    "git branch --force eat-41-lease-gate main",
    "git checkout -b eat-41-lease-gate && rm -rf src",
    "git worktree add --force .worktrees/eat-41",
    "git commit -m 'branch'",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("start-point를 지정한 checkout -b와 switch -c는 작업 파일을 갈아끼우므로 차단한다", () => {
  for (const command of ["git checkout -b x", "git switch -c x", "git branch x main"]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "branch-creation-command" },
      command,
    );
  }
  for (const command of [
    "git checkout -b x main",
    "git checkout -b tmp origin/main",
    "git switch -c x --discard-changes",
    "git switch -c x origin/main",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("claim의 --branch와 release의 --review는 lease 없이 허용하고 이름이 아닌 값은 차단한다", () => {
  for (const command of [
    "pnpm workflow:claim -- EAT-41 --branch eat-41-lease-gate",
    "pnpm workflow:claim -- --branch=eat-41-lease-gate EAT-41",
    "pnpm workflow:claim -- EAT-41 --branch eat-41-lease-gate --worktree ../..",
    "pnpm workflow:release --review",
    "pnpm workflow:release -- EAT-41 --review",
    "pnpm workflow:release:review",
    "pnpm workflow:release:review -- --worktree ../..",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "workflow-lifecycle-command" },
      command,
    );
  }
  for (const command of [
    "pnpm workflow:claim -- EAT-41 --branch",
    "pnpm workflow:claim -- EAT-41 --branch $(git branch --show-current)",
    "pnpm workflow:claim -- EAT-41 --branch 'eat 41'",
    "pnpm workflow:release -- --review > release.json",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("경로를 지정한 git 조회는 허용하고 경로 뒤의 변경 subcommand와 복합 명령은 차단한다", () => {
  for (const command of [
    "git -C F:/Project/eat-bid-service/.worktrees/eat-9-web-boundary-gate status -sb",
    "git -C ../.. log --oneline -3",
    'git -C "F:/Project/my repo" diff --check',
    "git -C F:\Project\eat-bid-service rev-parse --show-toplevel",
    "git -C ../.. branch --show-current",
    "git -C ../.. worktree list",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "read-or-verification-command" },
      command,
    );
  }
  for (const command of [
    "git -C ../.. commit -m change",
    "git -C ../.. checkout main",
    "git -C ../.. status && rm -rf src",
    "git -C $(pwd) status",
    "git -c core.pager=id log",
    "git -c core.editor=vi diff",
    "git -c core.pager={rm,-rf,foo} log",
    "git -c diff.external=writer -C ../.. diff",
    "git -C ../.. -c core.pager=id log",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("--worktree 인자가 붙은 workflow lifecycle 명령은 lease 없이 허용하고 치환이나 pipe는 차단한다", () => {
  for (const command of [
    "pnpm workflow:claim -- EAT-27 --worktree .worktrees/eat-27-agent-worktree-lease",
    "pnpm workflow:claim -- --worktree .worktrees/eat-27-agent-worktree-lease EAT-27",
    "pnpm workflow:release -- --worktree F:/Project/eat-bid-service",
    "pnpm workflow:release -- --worktree F:\Project\eat-bid-service",
    'pnpm workflow:doctor -- --worktree "F:/Project/my repo"',
    "pnpm workflow:doctor --worktree=../..",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "workflow-lifecycle-command" },
      command,
    );
  }
  for (const command of [
    "pnpm workflow:release -- --worktree $(pwd)",
    "pnpm workflow:release -- --worktree ../.. | tee release.log",
    "pnpm workflow:claim -- EAT-27 --worktree",
    "pnpm workflow:claim -- EAT-27 --force",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("chrome-devtools 조회·이동·스크립트 도구는 lease 없이 허용하고 입력·클릭·업로드 도구는 차단한다", () => {
  for (const toolName of [
    "mcp__chrome-devtools__navigate_page",
    "mcp__chrome-devtools__take_screenshot",
    "mcp__chrome-devtools__take_snapshot",
    "mcp__chrome-devtools__evaluate_script",
    "mcp__chrome-devtools__list_pages",
    "mcp__chrome-devtools__list_console_messages",
    "mcp__chrome-devtools__list_network_requests",
  ]) {
    assert.deepEqual(
      classifyToolCall(toolName, { url: "http://localhost:3000" }),
      { mutatesRepository: false, reason: "browser-inspection-tool" },
      toolName,
    );
  }
  for (const toolName of [
    "mcp__chrome-devtools__click",
    "mcp__chrome-devtools__fill_form",
    "mcp__chrome-devtools__type_text",
    "mcp__chrome-devtools__upload_file",
    "mcp__chrome-devtools__handle_dialog",
    "mcp__chrome-devtools__new_page",
  ]) {
    assert.equal(classifyToolCall(toolName, {}).mutatesRepository, true, toolName);
  }
});

test("kubectl 조회 subcommand는 lease 없이 허용하고 cluster를 바꾸는 subcommand와 복합 명령은 차단한다", () => {
  for (const command of [
    "kubectl get pods -n eatbid",
    "kubectl get workflows -n argo -o yaml",
    "kubectl describe deployment eatbid-server -n eatbid",
    "kubectl logs deploy/eatbid-server -n eatbid --tail=100",
    "kubectl top pods -n eatbid",
    "kubectl get pods -n eatbid | grep Running",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "read-or-verification-command" },
      command,
    );
  }
  for (const command of [
    "kubectl apply -f infra/k8s",
    "kubectl delete pod x -n eatbid",
    "kubectl exec -it pod -- sh",
    "kubectl edit deployment x",
    "kubectl get pods -o yaml > pods.yaml",
    "kubectl get pods | tee pods.txt",
    "kubectl get pods | xargs kubectl delete pod",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("curl GET 요청은 lease 없이 허용하고 본문·업로드·파일 출력 option이 있으면 차단한다", () => {
  for (const command of [
    "curl -s http://localhost:4000/api/v1/auctions",
    'curl -sS -H "Accept: application/json" https://api.example.com/health',
    "curl -X GET http://localhost:4000/api/v1/auctions",
    "curl -XHEAD http://localhost:4000",
    "curl --request HEAD -I http://localhost:4000",
    "curl -L --max-time 5 -w %{http_code} http://localhost:4000",
    "curl http://localhost:4000 | jq .",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "curl-read-request" },
      command,
    );
  }
  for (const command of [
    "curl -X POST http://localhost:4000/api/v1/auctions",
    "curl -XPOST http://localhost:4000",
    "curl --request=DELETE http://localhost:4000/x",
    "curl -d '{}' http://localhost:4000",
    "curl --data-binary @file http://localhost:4000",
    "curl -F file=@a.txt http://localhost:4000",
    "curl -T a.txt http://localhost:4000",
    "curl -o out.json http://localhost:4000",
    "curl -sSo out.json http://localhost:4000",
    "curl -O http://localhost:4000/a.zip",
    "curl -c cookies.txt http://localhost:4000",
    "curl -D headers.txt http://localhost:4000",
    "curl -K curlrc http://localhost:4000",
    "curl --json '{}' http://localhost:4000",
    "curl http://localhost:4000 | tee out.json",
    "curl http://localhost:4000 > out.json",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("따옴표 하나로 감싼 python -c와 node -e 읽기 코드는 lease 없이 허용한다", () => {
  for (const command of [
    `python -c "import json; print(json.load(open('canvas.json'))['nodes'][0])"`,
    "python3 -c 'import sys; print(sys.version)'",
    `py -c "from pathlib import Path; print(Path('a.xml').read_text()[:100])"`,
    `node -e "console.log(require('./package.json').scripts)"`,
    `node -e 'const fs = require("fs"); console.log(fs.readFileSync("a.txt", "utf8").length)'`,
    `node -p "process.versions.node"`,
    `node --eval "process.stdout.write(String(1 + 1))"`,
    `python -c "import sys; sys.stdout.write('x')" arg1`,
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "inline-interpreter-read-only" },
      command,
    );
  }
});

test("인라인 코드에 파일 쓰기·프로세스 실행·치환 토큰이 있거나 따옴표 밖에 chaining이 있으면 차단한다", () => {
  for (const command of [
    `python -c "open('a.txt', 'w').write('x')"`,
    `python -c "open('a.txt', mode='a')"`,
    `python -c "import json; json.dump({}, open('a.json', 'wb'))"`,
    `python -c "from pathlib import Path; Path('a').write_text('x')"`,
    `python -c "import shutil; shutil.rmtree('dist')"`,
    `python -c "import os; os.remove('a')"`,
    `python -c "import subprocess; subprocess.run(['rm', 'a'])"`,
    `python -c "exec(open('x').read())"`,
    `python -c "getattr(__builtins__, 'op' + 'en')('a', 'w')"`,
    `python -c "print(1 > 0)"`,
    `python -c "import os; print(os.getcwd())" > out.txt`,
    `python -c "print(1)" && rm -rf src`,
    `python -c "print(1)" | tee out.txt`,
    "python -c 'print(`whoami`)'",
    `python -c "print('$(rm a)')"`,
    "python -c print(1)",
    "python script.py",
    `node -e "require('fs').writeFileSync('a.txt', 'x')"`,
    `node -e "require('fs/promises').rm('dist', { recursive: true })"`,
    `node -e "require('child_process').execSync('rm -rf src')"`,
    `node -e "eval(process.argv[1])"`,
    `node -e "import('fs').then((fs) => fs.mkdirSync('x'))"`,
    `node -e "console.log(1)"; rm a.txt`,
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("issue 발행 명령은 lease 없이 허용하고 제목 자리에 다른 명령이 들어오면 차단한다", () => {
  for (const command of [
    'pnpm workflow:issue create --title "검증용 issue"',
    'pnpm workflow:issue create -- --title "eaT 명단 정규화를 마저 한다" --priority 2',
    'pnpm workflow:issue create --title="제목" --state Backlog',
    'pnpm workflow:issue create --title "제목" --description-file .superpowers/body.md',
    'pnpm workflow:issue create --title "제목" --project "R1 유료 투찰 Decision Loop"',
    "pnpm workflow:issues",
    "pnpm workflow:issues -- --state Ready --limit 20",
    "pnpm workflow:issue list --state Backlog",
    "pnpm --dir F:/Project/eat-bid-service/.claude/worktrees/eat-53 workflow:claim -- EAT-53",
    "pnpm --dir ../.. workflow:release -- EAT-37",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "workflow-lifecycle-command" },
      command,
    );
  }
  for (const command of [
    'pnpm workflow:issue create --title "제목" && rm -rf src',
    'pnpm workflow:issue create --title "$(cat body.md)"',
    'pnpm workflow:issue create --title "제목" > issue.json',
    'pnpm workflow:issue create --priority 9 --title "제목"',
    'pnpm workflow:issue create --title "제목" --force',
    "pnpm workflow:issues -- --limit 200",
    "pnpm --dir $(pwd) workflow:claim -- EAT-53",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("Infisical 폴더 명령만 lease 없이 허용하고 값을 다루거나 프로그램을 실행하는 명령은 차단한다", () => {
  for (const command of [
    "infisical secrets folders create --name postgres --path /runtime --env prod",
    "infisical secrets folders list --path /runtime --env prod",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "secret-folder-command" },
      command,
    );
  }
  for (const command of [
    "infisical secrets set POSTGRES_PASSWORD=x --env=prod --path=/runtime/postgres",
    "infisical secrets get POSTGRES_PASSWORD --env=prod --path=/runtime/postgres",
    "infisical secrets --env=prod --path=/runtime/postgres",
    "infisical run --env=prod -- node scripts/scratch.mjs",
    "infisical secrets folders create --name x && rm -rf src",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("pipe 단계 분리는 따옴표 안의 세로줄을 구분자로 세지 않는다", () => {
  assert.deepEqual(splitPipelineStages("git status -sb"), ["git status -sb"]);
  assert.deepEqual(splitPipelineStages("git status | tail -5"), ["git status ", " tail -5"]);
  assert.deepEqual(splitPipelineStages(`grep -n "a|b" src`), [`grep -n "a|b" src`]);
  assert.deepEqual(splitPipelineStages("grep -n 'a|b' src | wc -l"), [
    "grep -n 'a|b' src ",
    " wc -l",
  ]);
  assert.deepEqual(splitPipelineStages("git status || rm -rf src"), [
    "git status ",
    "",
    " rm -rf src",
  ]);
  // 닫히지 않은 따옴표는 어디까지가 한 단계인지 말할 수 없다.
  assert.equal(splitPipelineStages(`grep -n "a | b src`), null);
});

test("모든 pipe 단계가 읽기일 때만 통과시키고 쓰기 단계가 하나라도 있으면 차단한다", () => {
  for (const command of [
    "pnpm workflow:release -- EAT-37 | tail -3",
    "pnpm workflow:doctor | head -20",
    "pnpm workflow:worktree prune | Select-Object -First 5",
    "rg -n TODO src | wc -l",
    "grep -rn TODO src | head -20 | wc -l",
    "git log --oneline -20 | grep fix | head -5",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, false, command);
  }
  for (const command of [
    "pnpm workflow:release -- EAT-37 | tee release.log",
    "pnpm workflow:doctor | node scripts/write.mjs",
    "rg -n TODO src | xargs sed -i s/a/b/",
    "rm -rf src | tail -1",
    "grep -rn TODO src | head -5 | node scripts/write.mjs",
    "git status || rm -rf src",
    "cat a.txt |",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("추가·덮어쓰기 redirect는 pipe를 나누기 전에 명령 전체에서 먼저 차단한다", () => {
  for (const command of [
    "pnpm workflow:release -- EAT-37 | tail -3 > release.log",
    "pnpm workflow:release -- EAT-37 | tail -3 >> release.log",
    "pnpm workflow:doctor >> doctor.log",
    "grep -rn TODO src >> todo.txt",
    "git status -sb | head -5 >> status.txt",
    "cat a.txt >> b.txt",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: true, reason: "compound-or-writing-command" },
      command,
    );
  }
});

test("순수 읽기 명령은 lease 없이 허용하고 파일을 쓰거나 실행하는 술어가 붙으면 차단한다", () => {
  for (const command of [
    "grep -rn 'requestedIssue' tools/agent-workflow -A 25",
    "cat package.json",
    "head -50 AGENTS.md",
    "tail -n 20 docs/README.md",
    "wc -l tools/agent-workflow/workflow.mjs",
    "ls tools/agent-workflow",
    "find docs -name '*.md'",
    "find . -type f -newer package.json",
    "jq .scripts package.json",
  ]) {
    assert.deepEqual(
      classifyToolCall("Bash", { command }),
      { mutatesRepository: false, reason: "read-or-verification-command" },
      command,
    );
  }
  for (const command of [
    "find . -name '*.tmp' -delete",
    "find . -name '*.tmp' -exec rm {} ;",
    "find . -type f -execdir rm {} +",
    "find . -name '*.md' -fprintf out.txt %p",
    "sort -o sorted.txt a.txt",
    "tee out.txt",
    "cat a.txt > b.txt",
  ]) {
    assert.equal(classifyToolCall("Bash", { command }).mutatesRepository, true, command);
  }
});

test("저장소 밖 절대 경로 편집은 lease 없이 허용하고 저장소 안이나 상대 경로는 계속 차단한다", () => {
  assert.deepEqual(
    classifyToolCall(
      "Write",
      { file_path: "C:/Users/kano/.claude/projects/eatbid/memory/note.md" },
      insideRepository,
    ),
    { mutatesRepository: false, reason: "file-edit-outside-repository" },
  );
  assert.deepEqual(
    classifyToolCall(
      "Edit",
      { file_path: `${REPOSITORY_ROOT}/tools/agent-workflow/cli.mjs` },
      insideRepository,
    ),
    { mutatesRepository: true, reason: "file-edit-tool" },
  );
  // worktree root를 알 수 없거나 상대 경로라 어느 저장소인지 모르면 계속 mutation으로 둔다.
  assert.equal(classifyToolCall("Write", { file_path: "C:/tmp/a.md" }).mutatesRepository, true);
  assert.equal(
    classifyToolCall("Write", { file_path: "../../outside.md" }, insideRepository).mutatesRepository,
    true,
  );
  assert.equal(
    classifyToolCall("apply_patch", { command: "*** Add File: a.ts" }, insideRepository)
      .mutatesRepository,
    true,
  );
});
