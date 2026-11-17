// @module 책임: PreToolUse 훅: 운영 클러스터(eatbid-prod)·운영 DB를 바꾸는 셸 명령은 사람에게 묻는다(판정은 tools/agent-hooks/ops-command.mjs).
// 이 PC의 kubectl 기본 문맥이 운영이라 `--context`를 빼도 운영에 닿는다 — 그래서 문맥이 없으면 기본 문맥을 읽어 판단한다.
// 막지 않는다 — 물을 때는 permissionDecision 'ask'를 stdout으로 내고 0으로 끝난다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { opsConfirmReason } from '../../tools/agent-hooks/ops-command.mjs';

let command = '';
try {
  command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? '';
} catch {
  process.exit(0);
}
if (!/\bkubectl|\bargo/.test(command)) process.exit(0);

let currentContext = null;
if (!/--context/.test(command)) {
  try {
    currentContext = execFileSync('kubectl', ['config', 'current-context'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    // kubectl이 없으면 운영으로 보지 않는다.
  }
}

const reason = opsConfirmReason(command, currentContext);
if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${reason}. 운영에 바로 닿아요 — 사용자가 시킨 운영 작업일 때만 허락하세요.`
      }
    }) + '\n'
  );
}
process.exit(0);
