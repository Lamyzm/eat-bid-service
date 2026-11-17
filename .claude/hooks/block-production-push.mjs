// @module 책임: PreToolUse 훅: 배포 경로(main·deploy/prod 가지, release 태그)를 손으로 움직이는 셸 명령을 막는다(판정은 tools/agent-hooks/production-push.mjs).
// main은 PR로만(ADR 0050), deploy/prod는 릴리스 승격 잡만, release 태그는 `pnpm workflow:tag`만 움직인다.
// 입력은 stdin의 훅 JSON이다. 막을 때는 까닭을 stderr로 내고 2로 끝난다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { productionPushReason } from '../../tools/agent-hooks/production-push.mjs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
if (!/\bgit\b|\bgh\b/.test(command)) process.exit(0);

let currentBranch = null;
try {
  currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: input?.cwd ?? process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  // 저장소 밖이면 지금 가지는 모른 채로 본다.
}

const reason = productionPushReason(command, currentBranch);
if (reason) {
  process.stderr.write(
    [
      `막았어요: ${reason}.`,
      'main은 PR로만 들어가요 — 작업 가지에서 `pnpm workflow:pr`을 쓰세요.',
      'deploy/prod는 릴리스 빌드의 승격 잡만 쓰고, release 태그는 `pnpm workflow:tag -- vX.Y.Z`로만 만들어요.'
    ].join('\n') + '\n'
  );
  process.exit(2);
}
